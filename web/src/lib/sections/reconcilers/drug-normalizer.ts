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
 * Fingerprint for dedup: active ingredient (when known) or brand prefix
 * (when not), plus the stripped dose schedule. Identical fingerprints
 * → duplicate entry.
 *
 * Using the active ingredient as the dedup key means "TRITACE 5 mg"
 * and "Ramipril Actavis 5 mg" collapse to one entry — they're the
 * same drug. Falls back to the brand prefix when the medication isn't
 * in the CSV (unknown brand / multi-ingredient / international name).
 *
 * Entries with different dose schedules are NOT duplicates — legitimate
 * when a patient takes two strengths at different times.
 */
function fingerprintEntry(
  entry: string,
  locale: import("../section-agent").Language,
): string | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  const prefixMatch = trimmed.match(PREFIX_RE);
  if (!prefixMatch) return null;
  const prefix = prefixMatch[1].trim();
  if (prefix.length < 3) return null;

  // Prefer active ingredient (generic name) so brand-level variants
  // collapse; fall back to the brand prefix for unknown meds.
  const ingredient = getActiveIngredient(prefix, locale);
  const key = (ingredient ?? prefix).toUpperCase();

  // Dose-schedule signature (e.g. "1/3-0-0", "1-0-1", "200 mg")
  // folded to uppercase + no-whitespace so "1/3-0-0" and " 1/3-0-0 "
  // match on the same key.
  const rest = trimmed
    .slice(prefixMatch[0].length)
    .replace(/\s+/g, "")
    .toUpperCase();
  return `${key}::${rest}`;
}

export const drugNormalizer: Reconciler = (text, _source, ctx) => {
  if (!text.trim()) return text;

  const locale = ctx.language;
  const lines = text.split("\n");

  // Cross-line dedup: two entries with the same (prefix + dose)
  // fingerprint are duplicates — keep the first occurrence.
  const seen = new Set<string>();

  const correctedLines = lines.map((line) => {
    const entries = splitEntries(line);
    const kept: string[] = [];
    for (const entry of entries) {
      const normalized = normalizeEntry(entry, locale);
      const fp = fingerprintEntry(normalized, locale);
      if (fp) {
        if (seen.has(fp)) continue; // drop duplicate (same ingredient + dose)
        seen.add(fp);
      }
      kept.push(normalized);
    }
    return kept.join(",");
  });

  return correctedLines.join("\n");
};
