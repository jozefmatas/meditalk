/**
 * Drug-substitution guard reconciler.
 *
 * Catches when the LLM substitutes a brand name for a generic name (or
 * vice versa) despite being told not to. The LLM has strong pharmacological
 * knowledge and frequently swaps e.g. "Tamsulosín" → "Fokusin" or
 * "Prenessa" → "Co-Prenessa" because it knows they share an active
 * ingredient.
 *
 * The fix is deterministic: extract drug name prefixes from both the
 * source text and the draft, and when the draft contains a drug that's
 * NOT in the source but shares an active ingredient with a source drug,
 * replace the draft name with the source name.
 *
 * Runs BEFORE the drug-normalizer so the normalizer sees the corrected
 * (source-faithful) names.
 */
import type { Reconciler } from "./index";
import {
  getActiveIngredient,
  isActiveIngredient,
} from "../../lookup/medications";
import { logger } from "@/lib/logger";

// Same regex as drug-normalizer — extracts the drug name prefix before
// the first digit, dose notation, or mg/ml marker.
const PREFIX_RE =
  /^\s*([A-Za-zÁ-žÀ-ÿ][A-Za-zÁ-žÀ-ÿ0-9\-\s]*?)(?=\s+\d|\s+mg\b|\s+ml\b|\s+tbl\b|\s+podľa\b|\s+ráno\b|\s+večer\b|,|$)/i;

/**
 * Extract drug name prefixes from medication-formatted text (one drug per
 * line or comma-separated). Used for the draft output which is structured.
 */
function extractDrugPrefixes(text: string): Map<string, string> {
  const prefixes = new Map<string, string>();
  for (const line of text.split("\n")) {
    // Handle comma-separated entries on one line
    for (const entry of line.split(/,(?=\s+[A-Za-zÁ-žÀ-ÿ])/)) {
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

// Matches capitalized words (potential drug names) followed by dose info,
// even mid-sentence. Broader than PREFIX_RE — used for source scanning.
// No `i` flag — the uppercase anchor [A-ZÁ-Ž] must genuinely be uppercase
// to avoid matching regular words like "pacient".
const DRUG_IN_TEXT_RE =
  /([A-ZÁ-Ž][A-Za-zÁ-žÀ-ÿ\-]+(?:\s+[A-ZÁ-Ž][A-Za-zÁ-žÀ-ÿ]+)*)(?=\s+\d|\s+mg\b|\s+ml\b)/g;

/**
 * Scan free-form source text (transcripts, notes) for drug name mentions.
 * More permissive than `extractDrugPrefixes` — catches drug names
 * mid-sentence like "pacient berie Tamsulosín 0,4 mg".
 */
function scanDrugMentions(text: string): Map<string, string> {
  const prefixes = new Map<string, string>();
  for (const m of text.matchAll(DRUG_IN_TEXT_RE)) {
    const prefix = m[1].trim();
    if (prefix.length < 3) continue;
    const key = prefix.toLowerCase();
    if (!prefixes.has(key)) {
      prefixes.set(key, prefix);
    }
  }
  return prefixes;
}

/**
 * Resolve a drug name to its active ingredient fingerprint. Handles two
 * cases:
 *   1. The name is a brand/product in the CSV → getActiveIngredient()
 *   2. The name itself IS an active ingredient (doctor wrote the INN
 *      name, e.g. "Tamsulosín") → use it directly as the fingerprint
 */
function resolveIngredient(name: string, locale: string): string | null {
  // Try brand → ingredient first (e.g. "Fokusin" → "tamsulosín")
  const fromBrand = getActiveIngredient(name, locale);
  if (fromBrand) return fromBrand;

  // Check if the name itself is a known active ingredient
  // (e.g. "Tamsulosín" is in the CSV's active ingredient column)
  if (isActiveIngredient(name, locale)) return name.toLowerCase().trim();

  return null;
}

/**
 * Build a map from active ingredient → source drug prefix. Only includes
 * source drugs whose active ingredient can be resolved.
 */
function buildIngredientToSourceMap(
  sourcePrefixes: Map<string, string>,
  locale: string,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [, originalPrefix] of sourcePrefixes) {
    const ingredient = resolveIngredient(originalPrefix, locale);
    if (ingredient && !map.has(ingredient)) {
      map.set(ingredient, originalPrefix);
    }
  }
  return map;
}

/**
 * Collect all text from a RawSource (transcript + doctor notes + files).
 * Prefers `originalText` (pre-file-focus OCR text) when available, so the
 * guard compares against the true source — not Haiku's passage output
 * which may already contain substituted drug names.
 */
function collectSourceText(
  source: import("../section-agent").RawSource,
): string {
  const parts: string[] = [];
  if (source.transcript) parts.push(source.transcript);
  if (source.doctorNotes) parts.push(source.doctorNotes);
  for (const f of source.files ?? []) {
    if (f.originalText) parts.push(f.originalText);
    else if (f.text) parts.push(f.text);
  }
  return parts.join("\n");
}

export const drugSubstitutionGuard: Reconciler = (text, source, ctx) => {
  if (!text.trim()) return text;

  const locale = ctx.language;
  const sourceText = collectSourceText(source);
  if (!sourceText.trim()) return text;

  // Source: use both structured extraction AND free-text scanning
  // to catch drug names in transcripts, notes, and structured files.
  const sourcePrefixes = extractDrugPrefixes(sourceText);
  for (const [key, val] of scanDrugMentions(sourceText)) {
    if (!sourcePrefixes.has(key)) sourcePrefixes.set(key, val);
  }
  // Draft: structured extraction only (LA section is always formatted)
  const draftPrefixes = extractDrugPrefixes(text);

  // Build ingredient → source-prefix lookup
  const ingredientToSource = buildIngredientToSourceMap(sourcePrefixes, locale);

  let result = text;

  for (const [draftKey, draftPrefix] of draftPrefixes) {
    // If the draft drug name appears in the source, it's fine
    if (sourcePrefixes.has(draftKey)) continue;

    let sourcePrefix: string | undefined;

    // Strategy 1: same active ingredient (brand ↔ generic)
    const draftIngredient = resolveIngredient(draftPrefix, locale);
    if (draftIngredient) {
      sourcePrefix = ingredientToSource.get(draftIngredient);
    }

    // Strategy 2: name containment (Co-Prenessa contains Prenessa)
    // Catches combination-brand substitutions where the ingredients
    // differ but the names are clearly related.
    if (!sourcePrefix) {
      const draftLower = draftKey;
      for (const [srcKey, srcPrefix] of sourcePrefixes) {
        if (draftLower.includes(srcKey) || srcKey.includes(draftLower)) {
          sourcePrefix = srcPrefix;
          break;
        }
      }
    }

    if (!sourcePrefix) continue;

    // Substitution detected — replace the draft prefix with the source
    // prefix. Use case-insensitive replacement.
    logger.debug(
      `[drug-guard] substitution detected: "${draftPrefix}" → "${sourcePrefix}"`,
    );
    const escaped = draftPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "gi");
    result = result.replace(re, sourcePrefix);
  }

  return result;
};
