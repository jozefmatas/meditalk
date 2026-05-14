/**
 * Shared drug-text parsing primitives used by both the drug-normalizer
 * and drug-substitution-guard reconcilers.
 *
 * Owns the definition of "what constitutes a drug prefix" — the regex
 * pattern, the comma-splitting rule, and the structured-text extractor.
 */

/** Extracts the drug-name prefix at the start of an entry, before the
 *  first digit, dose notation (mg/ml/tbl), or clinical keyword. */
export const PREFIX_RE =
  /^\s*([A-Za-zÁ-žÀ-ÿ][A-Za-zÁ-žÀ-ÿ0-9\-\s]*?)(?=\s+\d|\s+mg\b|\s+ml\b|\s+tbl\b|\s+podľa\b|\s+ráno\b|\s+večer\b|,|$)/i;

/**
 * Split a medication line into individual entries. Comma splits only
 * when followed by whitespace + letter — decimal commas like "2,5 mg"
 * stay intact.
 */
export function splitEntries(line: string): string[] {
  return line.split(/,(?=\s+[A-Za-zÁ-žÀ-ÿ])/);
}

/**
 * Extract drug name prefixes from structured medication text (one per
 * line or comma-separated). Returns Map<lowercased-key, original-prefix>.
 */
export function extractDrugPrefixes(text: string): Map<string, string> {
  const prefixes = new Map<string, string>();
  for (const line of text.split("\n")) {
    for (const entry of splitEntries(line)) {
      const m = entry.match(PREFIX_RE);
      if (!m) continue;
      const prefix = m[1].trim();
      if (prefix.length < 3) continue;
      const key = prefix.toLowerCase();
      if (!prefixes.has(key)) {
        prefixes.set(key, prefix);
      }
    }
  }
  return prefixes;
}
