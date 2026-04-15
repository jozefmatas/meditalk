/**
 * Pass 1.6 — Deterministic Fact Resolution.
 *
 * After Pass 1.5 extraction + validation, one source of non-determinism
 * still leaks into the fact set: **self-corrections.** The speaker states
 * a fact and then corrects themselves ("his father died of MI — actually,
 * I mean stroke"). Haiku at temperature 0 is NOT strictly deterministic
 * and sometimes keeps only the corrected version, sometimes keeps both,
 * and rarely keeps only the pre-correction version. If both end up in
 * the fact set, the generator picks one or the other arbitrarily.
 *
 * This module is rule-based and deterministic by design. An LLM resolver
 * would add the very non-determinism we are trying to remove — defeating
 * the whole point of the layer. All operations are pure: the input facts
 * object is never mutated.
 *
 * Resolution rule:
 *   **Correction-phrase drop.** If a fact's evidence quote is
 *   immediately followed (within ~120 chars of the end of the quote)
 *   by a locale-specific correction phrase OR a locale-agnostic
 *   punctuation-bracketed negation (`, nie,` / `, no,` / `, ne,`) in
 *   the source text, the fact is dropped. The speaker corrected it.
 *
 * DESIGN NOTE — why we do NOT collapse "numeric duplicates".
 * An earlier version of this resolver also did "last-mention-wins" on
 * facts that shared a clinical key (e.g. "BP") but had different values.
 * The intent was to handle "1 broken rib ... actually 2 ribs" even
 * without an explicit correction phrase. That rule is WRONG: it also
 * collapses legitimate time series — a vitals table with BP at 14:02,
 * 14:31, 14:58, 15:12 is dropped down to a single reading. Real
 * corrections are always marked with a correction signal, which the
 * rule above already catches. If there is no correction signal between
 * two numerically different facts, they are NOT a correction — they are
 * either a time series (vitals over time), a progression (findings
 * evolved on imaging), or two distinct mentions the generator needs
 * to see. Exact duplicates are already handled by the validator
 * (see fact-validator.ts).
 *
 * Telemetry: every removal records a `ResolutionEvent` so the caller can
 * surface the count to the client and log it for the determinism audit.
 */
import type { SupportedLanguage } from "../types";
import type {
  ExtractedFact,
  ExtractedFacts,
  FactCategory,
  FactExtractionInput,
} from "./fact-extraction";
import { FACT_CATEGORIES, emptyExtractedFacts } from "./fact-extraction";
import { normalizeForMatch } from "./fact-validator";
import { logger } from "@/lib/logger";

/**
 * Locale-specific self-correction markers. Each entry is a word or short
 * phrase — case-insensitive, diacritic-insensitive via `normalizeForMatch`.
 *
 * We keep the list deliberately tight: only phrases that almost always
 * indicate an actual self-correction in clinical speech. Over-matching
 * (e.g. bare "no") would drop legitimate facts.
 *
 * Note: bare "nie" (sk) / "ne" (cs) CANNOT go in this list —
 * they are also common negations ("pacient nie je unavený"). For those,
 * see `RAW_CORRECTION_REGEX` which requires comma-bracketed punctuation.
 * English "no" is NOT in the regex either — Slovak "no" means "well/so"
 * (filler word) and would cause false positives. English corrections
 * like "no wait" / "wait no" are covered by phrases above.
 */
export const CORRECTION_PHRASES: Record<SupportedLanguage, string[]> = {
  sk: [
    "vlastne",
    "pardon",
    "prepac",
    "prepacte",
    "nie, skor",
    "nie skor",
    "ale vlastne",
    "chcel som povedat",
    "chcela som povedat",
    "myslel som",
    "myslela som",
    "myslim tym",
    "pockajte",
    "pockaj",
    "teda nie",
    "teda vlastne",
    "oprava",
    "opravim sa",
    "opravujem sa",
  ],
  cs: [
    "vlastne",
    "pardon",
    "promin",
    "prominte",
    "ne, spise",
    "ne spise",
    "ale vlastne",
    "chtel jsem rict",
    "chtela jsem rict",
    "myslel jsem",
    "myslela jsem",
    "myslim tim",
    "pockejte",
    "pockej",
    "teda ne",
    "teda vlastne",
    "oprava",
    "opravim se",
    "opravuji se",
  ],
  en: [
    "actually",
    "sorry",
    "i mean",
    "i meant",
    "rather",
    "correction",
    "let me correct",
    "no wait",
    "wait no",
    "scratch that",
    "strike that",
    "excuse me",
    "my mistake",
  ],
};

/**
 * Locale-agnostic punctuation-bracketed negation detector.
 *
 * Natural speech correction across many languages follows the structural
 * pattern:  `<fact A>, <short negation>, <fact B>`  — the speaker pauses,
 * utters a short negation token, pauses again, and states the correction.
 *
 * The comma-bracketing is what distinguishes a correction from an
 * in-sentence negation: bare "nie" / "no" / "ne" are common negations
 * ("pacient nie je unavený"), but "..., nie," / "..., no," / "..., ne,"
 * is almost never anything OTHER than a correction.
 *
 * We deliberately do NOT include "not" (English) because "pain, not
 * severe, persistent" is a valid in-sentence qualifier pattern that we
 * would wrongly drop. Only pure negation particles go here.
 *
 * Accepted bracket characters: comma, semicolon, period, colon, en/em dash.
 * Accepted negation cores: the set of short 2–5 char negation words found
 * across the locales we care about (Slavic, Germanic, Romance). This
 * covers self-correction across every locale we currently support plus
 * future ones without any per-locale wiring.
 */
const RAW_CORRECTION_REGEX =
  /[,;.:—–-]\s*(nie|ne|nein|non|nej|neni|nicht|ikke|inte|nix|niet)\s*[,;.:—–-]/iu;

/** Reason a fact was dropped by the resolver. */
export type ResolutionReason = "correction_phrase";

/** A single resolver decision. */
export interface ResolutionEvent {
  category: FactCategory;
  reason: ResolutionReason;
  dropped: ExtractedFact;
  /** Short human-readable detail for logging. */
  detail: string;
}

export interface ResolutionResult {
  resolvedFacts: ExtractedFacts;
  resolutions: ResolutionEvent[];
  counts: {
    total: number;
    correctionDrops: number;
  };
}

/**
 * Window (in characters of normalized source text) after the end of a
 * fact's evidence in which a correction phrase counts as correcting that
 * fact. 120 chars ≈ 20 words of Slavic speech — wide enough to cross a
 * sentence break, tight enough to avoid unrelated later mentions.
 */
const CORRECTION_WINDOW = 120;

/**
 * Main entry point. Resolves correction patterns and numeric duplicates
 * deterministically. The input is never mutated.
 */
export function resolveFacts(
  facts: ExtractedFacts,
  input: FactExtractionInput,
  locale: SupportedLanguage,
): ResolutionResult {
  const phrases = CORRECTION_PHRASES[locale] ?? CORRECTION_PHRASES.en;
  const normalizedPhrases = phrases
    .map((p) => normalizeForMatch(p))
    .filter((p) => p.length > 0);

  // Per-source normalized text + an index from normalized position to
  // source type/index. We search in normalized space because the evidence
  // quotes already use `normalizeForMatch` for equality checks. The raw
  // text is carried alongside so the locale-agnostic raw-text detector
  // can see commas/dashes that normalization strips.
  const sources = buildNormalizedSources(input);

  const resolutions: ResolutionEvent[] = [];
  const resolved = emptyExtractedFacts();
  resolved.usage = facts.usage;

  // -------- Correction-phrase drop --------
  // For each fact, find the position of its evidence in the source it
  // claims (or any source via fallback). If a correction phrase appears
  // within `CORRECTION_WINDOW` normalized chars after the evidence end,
  // drop the fact. In addition, a locale-agnostic raw-text regex catches
  // punctuation-bracketed negations (`..., nie, ...`) that can never be
  // expressed in the normalized phrase list.
  //
  // Everything that is NOT a correction is passed through untouched.
  // We intentionally do NOT collapse numerically different facts that
  // share a clinical key — see the module docstring for why.
  for (const category of FACT_CATEGORIES) {
    for (const fact of facts[category]) {
      const location = findEvidenceLocation(fact, sources);
      if (location === null) {
        // Evidence didn't match anywhere — validator should have caught
        // this already, but be defensive and pass it through.
        resolved[category].push(fact);
        continue;
      }
      const corrected = hasCorrectionAfter(
        location.normalizedText,
        location.endOffset,
        normalizedPhrases,
      );
      if (corrected) {
        resolutions.push({
          category,
          reason: "correction_phrase",
          dropped: fact,
          detail: `evidence followed by "${corrected}" within ${CORRECTION_WINDOW} chars`,
        });
        continue;
      }

      // Locale-agnostic raw-text pass: look for a punctuation-bracketed
      // negation ( ", nie," / ", no," / ", ne," ) right after the
      // evidence in the RAW source. This catches self-corrections that
      // survive normalization (which strips the commas that make the
      // pattern unambiguous).
      const rawMatch = hasRawCorrectionAfter(fact, sources);
      if (rawMatch) {
        resolutions.push({
          category,
          reason: "correction_phrase",
          dropped: fact,
          detail: `evidence followed by raw-text correction "${rawMatch}" within ${CORRECTION_WINDOW} chars`,
        });
        continue;
      }

      resolved[category].push(fact);
    }
  }

  const correctionDrops = resolutions.filter(
    (r) => r.reason === "correction_phrase",
  ).length;

  if (resolutions.length > 0) {
    logger.debug(
      `[fact-resolver] dropped ${resolutions.length} fact(s): ${correctionDrops} correction`,
      resolutions.slice(0, 5).map((r) => ({
        reason: r.reason,
        category: r.category,
        value: r.dropped.value,
        detail: r.detail,
      })),
    );
  }

  return {
    resolvedFacts: resolved,
    resolutions,
    counts: {
      total: resolutions.length,
      correctionDrops,
    },
  };
}

/** Pre-normalized source candidate. */
interface NormalizedSource {
  type: "transcript" | "doctor_notes" | "file";
  sourceIndex: number;
  rawText: string;
  normalizedText: string;
}

/** Flatten and normalize every source for position-based search. */
function buildNormalizedSources(
  input: FactExtractionInput,
): NormalizedSource[] {
  const out: NormalizedSource[] = [];
  input.chunks.forEach((text, i) => {
    if (text)
      out.push({
        type: "transcript",
        sourceIndex: i,
        rawText: text,
        normalizedText: normalizeForMatch(text),
      });
  });
  if (input.files) {
    input.files.forEach((f, i) => {
      if (f.text)
        out.push({
          type: "file",
          sourceIndex: i,
          rawText: f.text,
          normalizedText: normalizeForMatch(f.text),
        });
    });
  }
  if (input.doctorNotes && input.doctorNotes.trim()) {
    out.push({
      type: "doctor_notes",
      sourceIndex: 0,
      rawText: input.doctorNotes,
      normalizedText: normalizeForMatch(input.doctorNotes),
    });
  }
  return out;
}

/**
 * Find the normalized start/end position of a fact's evidence inside
 * whatever source it lives in. Tries the claimed source first, then
 * falls back to any source that contains the normalized evidence.
 */
function findEvidenceLocation(
  fact: ExtractedFact,
  sources: NormalizedSource[],
): { normalizedText: string; startOffset: number; endOffset: number } | null {
  const normalizedEvidence = normalizeForMatch(fact.source.evidence);
  if (!normalizedEvidence) return null;

  // 1) Try the claimed source.
  const claimed = sources.find(
    (s) =>
      s.type === fact.source.type && s.sourceIndex === fact.source.sourceIndex,
  );
  if (claimed) {
    const loc = locateInNormalized(claimed.normalizedText, normalizedEvidence);
    if (loc) {
      return {
        normalizedText: claimed.normalizedText,
        startOffset: loc.start,
        endOffset: loc.end,
      };
    }
  }

  // 2) Fallback: scan every source.
  for (const s of sources) {
    if (s === claimed) continue;
    const loc = locateInNormalized(s.normalizedText, normalizedEvidence);
    if (loc) {
      return {
        normalizedText: s.normalizedText,
        startOffset: loc.start,
        endOffset: loc.end,
      };
    }
  }

  // 3) Token-order fallback: if the exact normalized substring isn't in
  //    any source (the validator's tolerant path), use the position of
  //    the LAST matched token as the end offset. This is only used for
  //    correction detection, where we need a rough "end of evidence"
  //    anchor to look forward from.
  for (const s of sources) {
    const loc = locateByTokens(s.normalizedText, normalizedEvidence);
    if (loc) {
      return {
        normalizedText: s.normalizedText,
        startOffset: loc.start,
        endOffset: loc.end,
      };
    }
  }

  return null;
}

function locateInNormalized(
  haystack: string,
  needle: string,
): { start: number; end: number } | null {
  if (!needle) return null;
  const idx = haystack.indexOf(needle);
  if (idx === -1) return null;
  return { start: idx, end: idx + needle.length };
}

function locateByTokens(
  haystack: string,
  needle: string,
): { start: number; end: number } | null {
  const tokens = needle.split(" ").filter((t) => t.length >= 3);
  if (tokens.length === 0) return null;
  let cursor = 0;
  let start = -1;
  let end = -1;
  for (const token of tokens) {
    const found = haystack.indexOf(token, cursor);
    if (found === -1) return null;
    if (start === -1) start = found;
    end = found + token.length;
    cursor = end;
  }
  if (start === -1 || end === -1) return null;
  return { start, end };
}

/**
 * Does a correction phrase appear in the source within `CORRECTION_WINDOW`
 * chars after the end of the evidence? Returns the matched phrase (for
 * telemetry) or null if none found.
 */
function hasCorrectionAfter(
  normalizedSource: string,
  endOffset: number,
  normalizedPhrases: string[],
): string | null {
  const windowEnd = Math.min(
    normalizedSource.length,
    endOffset + CORRECTION_WINDOW,
  );
  const window = normalizedSource.slice(endOffset, windowEnd);
  if (!window) return null;
  for (const phrase of normalizedPhrases) {
    if (!phrase) continue;
    // Word-boundary match in normalized space: every non-alphanumeric
    // is already a space, so check the phrase is either the entire
    // window, at the start preceded by a space, surrounded by spaces,
    // or at the end preceded by a space.
    const idx = findPhraseWordBoundary(window, phrase);
    if (idx !== -1) return phrase;
  }
  return null;
}

/**
 * Find a phrase in a normalized string respecting word boundaries.
 * Normalized strings use spaces as the only separator, so word boundary
 * = start/end of string or a space character.
 */
function findPhraseWordBoundary(haystack: string, phrase: string): number {
  if (!phrase || !haystack) return -1;
  let from = 0;
  while (from <= haystack.length - phrase.length) {
    const idx = haystack.indexOf(phrase, from);
    if (idx === -1) return -1;
    const before = idx === 0 ? " " : haystack[idx - 1];
    const afterPos = idx + phrase.length;
    const after = afterPos >= haystack.length ? " " : haystack[afterPos];
    if (before === " " && after === " ") return idx;
    from = idx + 1;
  }
  return -1;
}

/**
 * Locale-agnostic raw-text correction detector.
 *
 * Finds the fact's evidence in the RAW (un-normalized) source text, then
 * checks the next `CORRECTION_WINDOW` raw characters for a
 * punctuation-bracketed negation matching `RAW_CORRECTION_REGEX`.
 *
 * This is the companion path to `hasCorrectionAfter`: the normalized
 * path catches explicit correction phrases ("actually", "vlastne",
 * "pardon"), and this path catches the structural `", nie,"` pattern
 * that depends on punctuation being present.
 *
 * Returns the matched negation token (for telemetry) or null.
 *
 * Search strategy for the evidence's raw offset:
 *   1. Direct substring match (evidence is supposed to be verbatim).
 *   2. Case-insensitive substring match as a tolerant fallback.
 * If neither works, we skip the raw path — the normalized path already
 * had its chance and presumably also failed.
 */
function hasRawCorrectionAfter(
  fact: ExtractedFact,
  sources: NormalizedSource[],
): string | null {
  const evidence = fact.source.evidence;
  if (!evidence) return null;

  // Order sources with the claimed one first for efficiency, but search
  // every source since facts can be mislabeled.
  const ordered = [
    ...sources.filter(
      (s) =>
        s.type === fact.source.type &&
        s.sourceIndex === fact.source.sourceIndex,
    ),
    ...sources.filter(
      (s) =>
        !(
          s.type === fact.source.type &&
          s.sourceIndex === fact.source.sourceIndex
        ),
    ),
  ];

  for (const source of ordered) {
    const raw = source.rawText;
    if (!raw) continue;

    // 1) Verbatim substring match.
    let idx = raw.indexOf(evidence);
    // 2) Case-insensitive fallback.
    if (idx === -1) {
      idx = raw.toLowerCase().indexOf(evidence.toLowerCase());
    }
    if (idx === -1) continue;

    const endOffset = idx + evidence.length;
    const windowEnd = Math.min(raw.length, endOffset + CORRECTION_WINDOW);
    const window = raw.slice(endOffset, windowEnd);
    if (!window) continue;

    const match = window.match(RAW_CORRECTION_REGEX);
    if (match) {
      return match[1].toLowerCase();
    }
  }
  return null;
}
