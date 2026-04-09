import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { IcdEntry, CandidateIcdCode } from "./types";

interface IcdIndex {
  byCode: Map<string, string>;
  byCategory: Map<string, IcdEntry[]>;
}

/** Per-locale cache */
const _cache = new Map<string, IcdIndex>();

/** Map locale to CSV filename */
function csvFileForLocale(locale: string): string {
  switch (locale) {
    case "sk": {
      const skPath = join(process.cwd(), "public", "icd-10", "ICD-10-SK.csv");
      if (existsSync(skPath)) return "ICD-10-SK.csv";
      return "ICD-10-GT.csv"; // fallback to English
    }
    case "cs": {
      const csPath = join(process.cwd(), "public", "icd-10", "ICD-10-CS.csv");
      if (existsSync(csPath)) return "ICD-10-CS.csv";
      return "ICD-10-GT.csv";
    }
    default:
      return "ICD-10-GT.csv";
  }
}

/**
 * Lazily load and parse an ICD-10 CSV for the given locale.
 * CSV format: "description",CODE-truncated_description
 * Code is everything before the first `-` in column 2.
 */
function loadIndex(locale = "en"): IcdIndex {
  const cached = _cache.get(locale);
  if (cached) return cached;

  const filename = csvFileForLocale(locale);
  const csvPath = join(process.cwd(), "public", "icd-10", filename);
  const raw = readFileSync(csvPath, "utf-8");
  const byCode = new Map<string, string>();
  const byCategory = new Map<string, IcdEntry[]>();

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;

    // Find the last comma that separates description from code column
    const lastComma = line.lastIndexOf(",");
    if (lastComma === -1) continue;

    const descRaw = line.substring(0, lastComma).replace(/^"|"$/g, "");
    const codeCol = line.substring(lastComma + 1).replace(/^"|"$/g, "");

    // Code is everything before the first dash
    const dashIdx = codeCol.indexOf("-");
    const code = dashIdx > 0 ? codeCol.substring(0, dashIdx) : codeCol.trim();
    if (!code) continue;

    byCode.set(code, descRaw);

    // Index by 3-character category prefix (strip dot for consistency)
    const category = code.replace(".", "").substring(0, 3);
    const arr = byCategory.get(category) || [];
    arr.push({ code, description: descRaw });
    byCategory.set(category, arr);
  }

  const index = { byCode, byCategory };
  _cache.set(locale, index);
  return index;
}

/** Get all ICD entries under a 3-char category (e.g. "I10" → all I10.x codes) */
export function getEntriesByCategory(
  category: string,
  locale = "en",
): IcdEntry[] {
  const { byCategory } = loadIndex(locale);
  const key = category.replace(".", "").substring(0, 3);
  return byCategory.get(key) || [];
}

/** Validate a specific ICD code exists */
export function isValidIcdCode(code: string, locale = "en"): boolean {
  const { byCode } = loadIndex(locale);
  return byCode.has(code);
}

/** Get the description for a specific code */
export function getIcdDescription(
  code: string,
  locale = "en",
): string | undefined {
  const { byCode } = loadIndex(locale);
  return byCode.get(code);
}

/**
 * Search ICD-10 codes by code prefix or description text.
 * Prioritizes code prefix matches, then description substring matches.
 */
export function searchIcd(
  query: string,
  limit = 20,
  locale = "en",
): IcdEntry[] {
  const { byCode } = loadIndex(locale);
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const codeMatches: IcdEntry[] = [];
  const descMatches: IcdEntry[] = [];

  for (const [code, description] of byCode) {
    if (codeMatches.length + descMatches.length >= limit) break;

    if (code.toLowerCase().startsWith(q)) {
      codeMatches.push({ code, description });
    } else if (description.toLowerCase().includes(q)) {
      descMatches.push({ code, description });
    }
  }

  return [...codeMatches, ...descMatches].slice(0, limit);
}

/**
 * Look up a single code with cross-format fallback.
 * EN uses no-dot codes (I2101), SK/CS use dotted WHO codes (I21.01).
 * Returns the matched code in the locale's native format.
 * Tries: exact → strip dots → add dot → prefix → category fallback.
 */
function findCode(
  code: string,
  byCode: Map<string, string>,
  byCategory: Map<string, IcdEntry[]>,
): { matchedCode: string; description: string; found: boolean } {
  // 1. Exact match
  if (byCode.has(code)) {
    return { matchedCode: code, description: byCode.get(code)!, found: true };
  }

  // 2. Try without dots (dotted input → undotted index)
  const noDot = code.replace(".", "");
  if (noDot !== code && byCode.has(noDot)) {
    return { matchedCode: noDot, description: byCode.get(noDot)!, found: true };
  }

  // 3. Try with dot after 3rd char (undotted input → dotted index)
  if (!code.includes(".") && code.length > 3) {
    const dotted = code.substring(0, 3) + "." + code.substring(3);
    if (byCode.has(dotted)) {
      return {
        matchedCode: dotted,
        description: byCode.get(dotted)!,
        found: true,
      };
    }
  }

  // 4. Category prefix match — find the best matching code in that category
  const catKey = noDot.substring(0, 3);
  const entries = byCategory.get(catKey);
  if (entries) {
    // Try to find a code whose digits match exactly (ignoring dots)
    const match = entries.find((e) => e.code.replace(".", "") === noDot);
    if (match) {
      return {
        matchedCode: match.code,
        description: match.description,
        found: true,
      };
    }

    // Try prefix: M259 → find first entry starting with M25.9 (e.g. M25.90)
    const prefixMatch = entries.find(
      (e) => e.code.replace(".", "").startsWith(noDot) && e.code !== catKey,
    );
    if (prefixMatch) {
      return {
        matchedCode: prefixMatch.code,
        description: prefixMatch.description,
        found: true,
      };
    }

    // Fall back to the category-level entry
    const catEntry = entries.find((e) => e.code.replace(".", "") === catKey);
    if (catEntry) {
      return {
        matchedCode: catEntry.code,
        description: catEntry.description,
        found: true,
      };
    }
  }

  // 5. Category-level lookup (e.g., G63 might be a standalone category)
  if (byCode.has(catKey)) {
    return {
      matchedCode: catKey,
      description: byCode.get(catKey)!,
      found: true,
    };
  }

  return { matchedCode: code, description: "", found: false };
}

/**
 * Resolve multiple ICD codes to their descriptions in bulk.
 * Handles cross-format lookups (dotted ↔ undotted codes).
 * Returns the matched code in the locale's native format (WHO dotted for SK/CS).
 */
export function resolveIcdCodes(
  codes: string[],
  locale = "en",
): Array<IcdEntry & { found: boolean }> {
  const { byCode, byCategory } = loadIndex(locale);
  return codes.map((inputCode) => {
    const result = findCode(inputCode, byCode, byCategory);
    return {
      code: result.matchedCode,
      description: result.description,
      found: result.found,
    };
  });
}

/**
 * Post-process generated text to replace LLM-written ICD descriptions
 * with canonical descriptions from the ICD-10 CSV.
 *
 * Only replaces descriptions when:
 * 1. The code appears at the start of a line or bullet point (standard output format)
 * 2. The code exists in our ICD-10 database
 *
 * This prevents hallucinated, paraphrased, or combined ICD descriptions.
 */
export function validateIcdDescriptions(text: string, locale = "en"): string {
  if (!text) return text;

  // Match ICD codes in bullet/list format as instructed by our prompt:
  //   "- I21.0 Description text"
  //   "I10 Description text" (at start of line)
  // The code must be followed by at least one space and description text.
  return text.replace(
    /^(\s*[-•*]?\s*)([A-Z]\d{2}(?:\.\d{1,4})?)\s+([^\n]+)/gm,
    (match, bullet: string, code: string) => {
      const results = resolveIcdCodes([code], locale);
      if (results.length > 0 && results[0].found) {
        return `${bullet}${results[0].code} ${results[0].description}`;
      }
      return match;
    },
  );
}

/**
 * Extract ICD-10 codes that actually appear in the generated report sections.
 *
 * Reuses the same line-anchored regex as `validateIcdDescriptions()` — codes must
 * appear at the start of a line (optionally after a bullet marker) followed by a
 * description, matching the format our generation prompt enforces.
 *
 * Resolves every matched code through the CSV for the given locale, drops codes
 * that don't exist, and deduplicates by canonical code (first appearance wins)
 * so `I210` and `I21.0` collapse into a single entry.
 *
 * IMPORTANT: must be called AFTER `validateIcdDescriptions()` so the descriptions
 * passed on to the sidebar are canonical CSV text.
 */
export function extractIcdCodesFromSections(
  sectionContents: Record<string, string>,
  locale = "en",
): CandidateIcdCode[] {
  const seen = new Set<string>();
  const extracted: CandidateIcdCode[] = [];
  const regex = /^(\s*[-•*]?\s*)([A-Z]\d{2}(?:\.\d{1,4})?)\s+([^\n]+)/gm;

  for (const text of Object.values(sectionContents)) {
    if (!text) continue;
    // `matchAll` on a /g regex yields every match without manual exec loops
    for (const match of text.matchAll(regex)) {
      const rawCode = match[2];
      const [resolved] = resolveIcdCodes([rawCode], locale);
      if (!resolved || !resolved.found) continue;
      if (seen.has(resolved.code)) continue;
      seen.add(resolved.code);
      extracted.push({
        code: resolved.code,
        description: resolved.description,
        confidence: "high",
        sourceConceptIds: [],
      });
    }
  }

  return extracted;
}

/**
 * Build a compact ICD reference string for the LLM prompt.
 * Only includes categories from the given hints, limited per category.
 */
export function buildIcdReferenceForConcepts(
  categoryHints: string[],
  maxPerCategory = 10,
  locale = "en",
): string {
  const lines: string[] = [];
  const seen = new Set<string>();

  for (const hint of categoryHints) {
    const entries = getEntriesByCategory(hint, locale);
    let count = 0;
    for (const entry of entries) {
      if (seen.has(entry.code)) continue;
      seen.add(entry.code);
      lines.push(`${entry.code}: ${entry.description}`);
      count++;
      if (count >= maxPerCategory) break;
    }
  }

  return lines.join("\n");
}
