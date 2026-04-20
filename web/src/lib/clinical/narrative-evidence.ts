/**
 * Narrative evidence extraction — the "Strengthen Step 5" tightening.
 *
 * The Opus tier (TO/HPI + Plan) used to receive the raw `doctorNotes` and
 * full `fileTexts` dump, which was the last residual contamination vector
 * — Opus could see medication lists, substance-use history, and allergy
 * data that belong in other sections, and sometimes wove them into the
 * present-illness narrative.
 *
 * This module replaces that raw dump with a deterministic, fact-scoped
 * set of source snippets: for each fact already assigned to an Opus-tier
 * section, we pull a small window (±windowChars) of context around the
 * fact's verbatim evidence quote in its original source. The resulting
 * snippets give Opus the narrative texture (onset phrases, refusal
 * language, time anchors) it needs to write a natural TO/Plan without
 * letting it wander into OA / SA / LA territory.
 *
 * The extraction is fully deterministic — same facts + same sources =
 * same snippets, in the same order, every run.
 */

import type { ExtractedFact } from "./fact-extraction";

/** A single curated source window presented to Opus. */
export interface NarrativeSnippet {
  type: "transcript" | "doctor_notes" | "file";
  sourceIndex: number;
  /** File name when `type === "file"`, otherwise undefined. */
  fileName?: string;
  /** Optional per-file directive preserved for Opus. */
  fileDirective?: string;
  /** Character offset of the snippet in the source. */
  offset: number;
  /** The extracted window, trimmed and whitespace-normalized. */
  text: string;
}

/** Raw sources we pull windows from — same shape the extractor received. */
export interface NarrativeSources {
  chunks: string[];
  doctorNotes?: string;
  files?: { name: string; type: string; text: string; context?: string }[];
}

export interface NarrativeEvidenceOptions {
  /** Half-width of the context window around each evidence match (default 120). */
  windowChars?: number;
  /** Hard cap on total characters emitted across all snippets (default 3000). */
  maxTotalChars?: number;
}

/**
 * Extract narrative evidence for the Opus tier.
 *
 * @param opusFacts  Facts already assigned to an Opus-tier section (TO/HPI + Plan).
 * @param sources    The original source material.
 * @param options    Window + budget tuning knobs.
 * @returns Merged, deduplicated snippets grouped by source.
 */
export function extractNarrativeEvidence(
  opusFacts: ExtractedFact[],
  sources: NarrativeSources,
  options: NarrativeEvidenceOptions = {},
): NarrativeSnippet[] {
  const windowChars = options.windowChars ?? 120;
  const maxTotalChars = options.maxTotalChars ?? 3000;

  if (opusFacts.length === 0) return [];

  // Step 1 — per fact, locate its evidence quote in the declared source
  //           and compute a [start, end) character range to keep.
  type Range = {
    type: NarrativeSnippet["type"];
    sourceIndex: number;
    start: number;
    end: number;
  };
  const ranges: Range[] = [];

  for (const fact of opusFacts) {
    const sourceText = resolveSourceText(fact, sources);
    if (!sourceText) continue;

    const match = findEvidenceOffset(fact.source.evidence, sourceText);
    if (match === null) continue;

    const start = Math.max(0, match.start - windowChars);
    const end = Math.min(sourceText.length, match.end + windowChars);
    ranges.push({
      type: fact.source.type,
      sourceIndex: fact.source.sourceIndex,
      start,
      end,
    });
  }

  if (ranges.length === 0) return [];

  // Step 2 — group ranges by (type, sourceIndex) and merge overlaps so we
  //           don't emit the same sentence twice when two facts share context.
  const groupKey = (r: Range) => `${r.type}:${r.sourceIndex}`;
  const grouped = new Map<string, Range[]>();
  for (const r of ranges) {
    const key = groupKey(r);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  const snippets: NarrativeSnippet[] = [];
  let budget = maxTotalChars;

  for (const [, group] of grouped) {
    group.sort((a, b) => a.start - b.start);
    const merged: Range[] = [];
    for (const r of group) {
      const tail = merged[merged.length - 1];
      if (tail && r.start <= tail.end) {
        tail.end = Math.max(tail.end, r.end);
      } else {
        merged.push({ ...r });
      }
    }

    const first = merged[0];
    const sourceText = resolveSourceText(
      { source: { type: first.type, sourceIndex: first.sourceIndex } },
      sources,
    );
    if (!sourceText) continue;

    for (const r of merged) {
      if (budget <= 0) break;
      const raw = sourceText.slice(r.start, r.end);
      const snapped = snapToWordBoundaries(raw);
      if (!snapped) continue;

      // Clip to budget without leaving a dangling partial word — trim
      // any trailing non-whitespace run so the snippet still reads
      // cleanly even at the budget boundary.
      const text =
        snapped.length <= budget
          ? snapped
          : snapped
              .slice(0, budget)
              .replace(/\s+\S*$/u, "")
              .trim();
      if (!text) continue;
      budget -= text.length;

      const fileInfo =
        first.type === "file" && sources.files?.[first.sourceIndex]
          ? {
              fileName: sources.files[first.sourceIndex].name,
              fileDirective: sources.files[first.sourceIndex].context,
            }
          : {};

      snippets.push({
        type: first.type,
        sourceIndex: first.sourceIndex,
        offset: r.start,
        text,
        ...fileInfo,
      });
    }
    if (budget <= 0) break;
  }

  return snippets;
}

/**
 * Format narrative snippets as a compact block suitable for the Opus user
 * message — one block per snippet, labeled by source type/index so Opus
 * can distinguish spoken transcript from written doctor notes.
 */
export function formatNarrativeEvidence(snippets: NarrativeSnippet[]): string {
  if (snippets.length === 0) return "";

  const lines: string[] = [
    "NARRATIVE EVIDENCE (scoped source snippets — use ONLY for language/texture of TO/Plan; do NOT extract new clinical facts from these):",
  ];
  for (const s of snippets) {
    const header =
      s.type === "file"
        ? `[File "${s.fileName ?? s.sourceIndex}"]`
        : s.type === "doctor_notes"
          ? "[Doctor's notes]"
          : `[Transcript chunk ${s.sourceIndex}]`;
    lines.push(header);
    if (s.fileDirective) {
      lines.push(`DOCTOR'S DIRECTIVE FOR THIS FILE: ${s.fileDirective}`);
    }
    lines.push(s.text);
    lines.push("");
  }
  return lines.join("\n").trim();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the source text a fact's source reference points at. Mirrors
 * the resolver used by `fact-validator` so evidence lookup is consistent
 * across the pipeline.
 */
function resolveSourceText(
  fact: {
    source: {
      type: "transcript" | "doctor_notes" | "file";
      sourceIndex: number;
    };
  },
  sources: NarrativeSources,
): string | null {
  const { type, sourceIndex } = fact.source;
  if (type === "transcript") return sources.chunks[sourceIndex] ?? null;
  if (type === "doctor_notes") {
    return sourceIndex === 0 ? (sources.doctorNotes ?? null) : null;
  }
  if (type === "file") return sources.files?.[sourceIndex]?.text ?? null;
  return null;
}

/**
 * Position-preserving diacritic strip — each input character maps to
 * exactly one output character, so offsets in the normalized string
 * align 1:1 with offsets in the original. Covers the Slovak / Czech
 * diacritic set we see in clinical text.
 */
const DIACRITIC_MAP: Record<string, string> = {
  á: "a",
  à: "a",
  â: "a",
  ä: "a",
  ã: "a",
  å: "a",
  Á: "a",
  À: "a",
  Â: "a",
  Ä: "a",
  Ã: "a",
  Å: "a",
  č: "c",
  ć: "c",
  ç: "c",
  Č: "c",
  Ć: "c",
  Ç: "c",
  ď: "d",
  Ď: "d",
  é: "e",
  è: "e",
  ê: "e",
  ë: "e",
  ě: "e",
  É: "e",
  È: "e",
  Ê: "e",
  Ë: "e",
  Ě: "e",
  í: "i",
  ì: "i",
  î: "i",
  ï: "i",
  Í: "i",
  Ì: "i",
  Î: "i",
  Ï: "i",
  ľ: "l",
  ĺ: "l",
  ł: "l",
  Ľ: "l",
  Ĺ: "l",
  Ł: "l",
  ň: "n",
  ñ: "n",
  Ň: "n",
  Ñ: "n",
  ó: "o",
  ò: "o",
  ô: "o",
  ö: "o",
  õ: "o",
  ø: "o",
  Ó: "o",
  Ò: "o",
  Ô: "o",
  Ö: "o",
  Õ: "o",
  Ø: "o",
  ŕ: "r",
  ř: "r",
  Ŕ: "r",
  Ř: "r",
  š: "s",
  ś: "s",
  ș: "s",
  Š: "s",
  Ś: "s",
  Ș: "s",
  ť: "t",
  ț: "t",
  Ť: "t",
  Ț: "t",
  ú: "u",
  ù: "u",
  û: "u",
  ü: "u",
  ů: "u",
  Ú: "u",
  Ù: "u",
  Û: "u",
  Ü: "u",
  Ů: "u",
  ý: "y",
  ÿ: "y",
  Ý: "y",
  Ÿ: "y",
  ž: "z",
  ź: "z",
  ż: "z",
  Ž: "z",
  Ź: "z",
  Ż: "z",
};

function stripDiacriticsPreserveLength(s: string): string {
  let out = "";
  for (const ch of s) {
    out += (DIACRITIC_MAP[ch] ?? ch).toLowerCase();
  }
  return out;
}

/**
 * Find where the evidence quote starts and ends in the source.
 *
 * Strategy:
 *  1. Exact case-insensitive substring (fast path for verbatim quotes).
 *  2. Diacritics-insensitive substring using a position-preserving map
 *     so the index translates 1:1 back to the original source.
 *  3. Token fallback: locate the first and last ≥4-char content tokens
 *     of the evidence in the diacritic-stripped source; return the
 *     range they bracket. The window padding (`windowChars`) absorbs
 *     any mid-evidence slack.
 *
 * Returns `null` when the evidence cannot be located.
 */
function findEvidenceOffset(
  evidence: string,
  source: string,
): { start: number; end: number } | null {
  if (!evidence || !source) return null;

  // Exact case-insensitive match — the common path for verbatim quotes.
  const exactIdx = source.toLowerCase().indexOf(evidence.toLowerCase());
  if (exactIdx !== -1) {
    return { start: exactIdx, end: exactIdx + evidence.length };
  }

  const strippedSource = stripDiacriticsPreserveLength(source);
  const strippedEvidence = stripDiacriticsPreserveLength(evidence);

  const normIdx = strippedSource.indexOf(strippedEvidence);
  if (normIdx !== -1) {
    return { start: normIdx, end: normIdx + strippedEvidence.length };
  }

  // Token fallback — locate first + last ≥4-char content tokens.
  const tokens = strippedEvidence
    .split(/[^a-z0-9]+/u)
    .filter((t) => t.length >= 4);
  if (tokens.length === 0) return null;
  const firstTok = tokens[0];
  const lastTok = tokens[tokens.length - 1];

  const firstHit = strippedSource.indexOf(firstTok);
  if (firstHit === -1) return null;
  const lastHit =
    tokens.length > 1
      ? strippedSource.indexOf(lastTok, firstHit + firstTok.length)
      : firstHit;
  if (lastHit === -1) {
    return { start: firstHit, end: firstHit + firstTok.length };
  }
  return { start: firstHit, end: lastHit + lastTok.length };
}

/**
 * Expand a raw-char-range slice to the nearest word boundaries and
 * collapse whitespace to a single space so the snippet reads cleanly.
 */
function snapToWordBoundaries(raw: string): string {
  if (!raw) return raw;
  let start = 0;
  let end = raw.length;
  // Trim leading partial-word fragment until first whitespace.
  while (start < end && !/\s/.test(raw[start])) start++;
  while (start < end && /\s/.test(raw[start])) start++;
  // Trim trailing partial-word fragment until last whitespace.
  while (end > start && !/\s/.test(raw[end - 1])) end--;
  while (end > start && /\s/.test(raw[end - 1])) end--;
  const trimmed = raw.slice(start, end);
  return trimmed.replace(/\s+/g, " ").trim();
}
