/**
 * drug-normalizer reconciler.
 *
 * Runs after the section-agent produces text for a medications-style section.
 * For each line that starts with a drug-name token, try to correct the brand
 * against the locale's medication CSV (`lookup/medications.ts`). Known
 * transcription typos like "Paretic" → "Paretin" get fixed; dose, frequency,
 * and any trailing notes on the line are preserved verbatim.
 *
 * If the leading token is already a valid brand, the line is untouched.
 * If no close match exists in the CSV, the line is left as-is (the doctor
 * may have written a less-common product the CSV doesn't cover).
 */
import type { Reconciler } from "./index";
import {
  correctMedicationBaseName,
  isValidMedication,
} from "../../lookup/medications";

// Matches the drug-name prefix at the start of a line:
//   "Paretic 1-0-0"           → "Paretic"
//   "Betaloc ZOK 25 mg, ..."  → "Betaloc ZOK"
//   "Co-Prenessa 4 mg/1,25 mg"→ "Co-Prenessa"
// Stops at the first digit, dash-dose notation, mg/ml marker, or comma.
const PREFIX_RE =
  /^\s*([A-Za-zÁ-žÀ-ÿ][A-Za-zÁ-žÀ-ÿ0-9\-\s]*?)(?=\s+\d|\s+mg\b|\s+ml\b|\s+tbl\b|\s+podľa\b|\s+ráno\b|\s+večer\b|,|$)/i;

export const drugNormalizer: Reconciler = (text, _source, ctx) => {
  if (!text.trim()) return text;

  const locale = ctx.language;
  const lines = text.split("\n");

  const correctedLines = lines.map((line) => {
    if (!line.trim()) return line;
    const prefixMatch = line.match(PREFIX_RE);
    if (!prefixMatch) return line;

    const originalPrefix = prefixMatch[1].trim();
    if (!originalPrefix) return line;

    // Short prefixes (1-2 chars) are almost never drug names — skip to
    // avoid spuriously "correcting" them.
    if (originalPrefix.length < 3) return line;

    // If the brand is already valid, leave it alone.
    if (isValidMedication(originalPrefix, locale)) return line;

    const correction = correctMedicationBaseName(originalPrefix, locale);
    if (!correction) return line;

    // Replace ONLY the leading drug-name prefix, preserving dose/frequency.
    const start = line.indexOf(originalPrefix);
    if (start < 0) return line;
    return (
      line.slice(0, start) +
      correction.correctedBaseName +
      line.slice(start + originalPrefix.length)
    );
  });

  return correctedLines.join("\n");
};
