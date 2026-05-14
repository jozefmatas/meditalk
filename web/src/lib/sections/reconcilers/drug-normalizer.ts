/**
 * drug-normalizer reconciler.
 *
 * Runs after the section-agent produces text for a medications-style section.
 * For each medication entry (one per line, or comma-separated on one line),
 * try to correct the brand against the locale's medication CSV
 * (`lookup/medications.ts`). Known transcription typos like "Paretic" →
 * "Paretin" get fixed; dose, frequency, and any trailing notes are preserved.
 *
 * Known Slovak clinical abbreviations (ANP for Anopyrin, ASA for Aspirin)
 * are short-circuited through ABBREVIATION_ALIASES before the fuzzy matcher
 * fires — otherwise substring matching lands us on unrelated brands
 * (ANP → Anpharm, etc.).
 */
import type { Reconciler } from "./index";
import {
  correctMedicationBaseName,
  getActiveIngredient,
  isActiveIngredient,
  isValidMedication,
} from "../../lookup/medications";

// Matches the drug-name prefix at the start of a line OR entry:
//   "Paretic 1-0-0"           → "Paretic"
//   "Betaloc ZOK 25 mg, ..."  → "Betaloc ZOK"
//   "Co-Prenessa 4 mg/1,25 mg"→ "Co-Prenessa"
// Stops at the first digit, dash-dose notation, mg/ml marker, or comma.
const PREFIX_RE =
  /^\s*([A-Za-zÁ-žÀ-ÿ][A-Za-zÁ-žÀ-ÿ0-9\-\s]*?)(?=\s+\d|\s+mg\b|\s+ml\b|\s+tbl\b|\s+podľa\b|\s+ráno\b|\s+večer\b|,|$)/i;

/**
 * Slovak clinical abbreviations that the fuzzy matcher otherwise
 * mis-expands via substring hits. Key is uppercase; matched
 * case-insensitively. Extend as new failures surface in production.
 */
const ABBREVIATION_ALIASES: Record<string, string> = {
  ANP: "ANOPYRIN", // ANOpyrin shorthand in discharge letters
  ASA: "Aspirin", // acetylsalicylic acid
  NTG: "Nitroglycerín",
};

/**
 * Splits a medication-section line into individual entries. Handles
 * both one-per-line (single entry) and comma-separated (multiple meds
 * on one line, LA's new preferred format). Comma splits only when the
 * next character is whitespace + letter — so "Arixtra 2,5 mg" stays
 * intact (inner decimal comma is NOT an entry boundary).
 */
function splitEntries(line: string): string[] {
  return line.split(/,(?=\s+[A-Za-zÁ-žÀ-ÿ])/);
}

function normalizeEntry(
  entry: string,
  locale: import("../section-agent").Language,
): string {
  if (!entry.trim()) return entry;

  const prefixMatch = entry.match(PREFIX_RE);
  if (!prefixMatch) return entry;

  const originalPrefix = prefixMatch[1].trim();
  if (!originalPrefix) return entry;

  if (originalPrefix.length < 3) return entry;

  // Alias short-circuit: known Slovak shorthands map directly to their
  // canonical brand. Bypasses the fuzzy matcher entirely.
  const aliasHit = ABBREVIATION_ALIASES[originalPrefix.toUpperCase()];
  if (aliasHit) {
    const start = entry.indexOf(originalPrefix);
    if (start < 0) return entry;
    return (
      entry.slice(0, start) +
      aliasHit +
      entry.slice(start + originalPrefix.length)
    );
  }

  // If the brand is already valid, leave it alone.
  if (isValidMedication(originalPrefix, locale)) return entry;

  // Don't "correct" known active ingredient names (INN/generic) — they're
  // legitimate. Otherwise the normalizer replaces e.g. "Tamsulosín" with
  // "Fokusin" via active-ingredient search in the CSV.
  if (isActiveIngredient(originalPrefix, locale)) return entry;

  const correction = correctMedicationBaseName(originalPrefix, locale);
  if (!correction) return entry;

  const start = entry.indexOf(originalPrefix);
  if (start < 0) return entry;
  return (
    entry.slice(0, start) +
    correction.correctedBaseName +
    entry.slice(start + originalPrefix.length)
  );
}

/**
 * Parse a normalized entry into its dedup-relevant parts.
 * Returns `null` when the entry has no recognizable brand prefix
 * (unknown / multi-ingredient / free-text); such entries are passed
 * through unchanged.
 */
interface ParsedEntry {
  key: string; // active ingredient (when known) else brand prefix, UPPER
  dose: string; // dose-schedule signature (UPPER, no whitespace), "" if absent
}

function parseEntry(
  entry: string,
  locale: import("../section-agent").Language,
): ParsedEntry | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  const prefixMatch = trimmed.match(PREFIX_RE);
  if (!prefixMatch) return null;
  const prefix = prefixMatch[1].trim();
  if (prefix.length < 3) return null;

  // Prefer active ingredient (generic name) so brand-level variants
  // (TRITACE, Ramipril Actavis, Piramil) collapse to a single key.
  // Fall back to the brand prefix for meds the CSV doesn't index.
  const ingredient = getActiveIngredient(prefix, locale);
  const key = (ingredient ?? prefix).toUpperCase();

  // Dose-schedule signature (e.g. "1/3-0-0", "1-0-1", "200 mg")
  // folded to no-whitespace + upper so cosmetic drift doesn't prevent
  // match. Empty string when the entry has no dose info.
  const dose = trimmed
    .slice(prefixMatch[0].length)
    .replace(/\s+/g, "")
    .toUpperCase();

  return { key, dose };
}

export const drugNormalizer: Reconciler = (text, _source, ctx) => {
  if (!text.trim()) return text;

  const locale = ctx.language;
  const lines = text.split("\n");

  // Pass 1 — flatten all entries across lines, normalize each, and
  // index by active-ingredient key. We need the full picture before
  // making dedup decisions because order matters: if "Ramipril
  // Actavis" (no dose) appears BEFORE "TRITACE 1/3-0-0", a one-pass
  // approach would keep both. The two-pass approach collapses them
  // regardless of input order.
  interface Flat {
    line: number;
    normalized: string;
    parsed: ParsedEntry | null;
  }
  const flat: Flat[] = [];
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    for (const raw of splitEntries(lines[lineIdx])) {
      const normalized = normalizeEntry(raw, locale);
      const parsed = parseEntry(normalized, locale);
      flat.push({ line: lineIdx, normalized, parsed });
    }
  }

  // Keys that appear with a non-empty dose somewhere in the text.
  // Dose-less mentions of these keys are dropped as redundant.
  const keysWithDose = new Set<string>();
  for (const f of flat) {
    if (f.parsed?.dose) keysWithDose.add(f.parsed.key);
  }

  // Pass 2 — compute keep flags.
  // Rules:
  //   1. If entry has no recognizable prefix, keep (pass-through).
  //   2. If the entry's (key + dose) fingerprint was already kept, drop
  //      (exact duplicate — same brand/generic AND same dose).
  //   3. If entry has NO dose AND some other entry in the text has the
  //      same key with a dose, drop as redundant mention.
  const seenFingerprints = new Set<string>();
  const keep: boolean[] = [];
  for (const f of flat) {
    if (!f.parsed) {
      keep.push(true);
      continue;
    }
    const { key, dose } = f.parsed;
    if (!dose && keysWithDose.has(key)) {
      keep.push(false);
      continue;
    }
    const fp = `${key}::${dose}`;
    if (seenFingerprints.has(fp)) {
      keep.push(false);
      continue;
    }
    seenFingerprints.add(fp);
    keep.push(true);
  }

  // Pass 3 — reconstruct, preserving original line structure + order.
  const byLine: string[][] = lines.map(() => []);
  for (let i = 0; i < flat.length; i++) {
    if (keep[i]) byLine[flat[i].line].push(flat[i].normalized);
  }
  return byLine.map((entries) => entries.join(",")).join("\n");
};
