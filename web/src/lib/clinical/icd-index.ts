import { readFileSync } from "fs";
import { join } from "path";
import type { IcdEntry } from "./types";

let _codeMap: Map<string, string> | null = null;
let _categoryMap: Map<string, IcdEntry[]> | null = null;

/**
 * Lazily load and parse ICD-10-GT.csv.
 * CSV format: "description",CODE-truncated_description
 * Code is everything before the first `-` in column 2.
 */
function loadIndex() {
  if (_codeMap && _categoryMap) {
    return { byCode: _codeMap, byCategory: _categoryMap };
  }

  const csvPath = join(process.cwd(), "public", "icd-10", "ICD-10-GT.csv");
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

    // Index by 3-character category prefix
    const category = code.substring(0, 3);
    const arr = byCategory.get(category) || [];
    arr.push({ code, description: descRaw });
    byCategory.set(category, arr);
  }

  _codeMap = byCode;
  _categoryMap = byCategory;
  return { byCode, byCategory };
}

/** Get all ICD entries under a 3-char category (e.g. "I10" → all I10.x codes) */
export function getEntriesByCategory(category: string): IcdEntry[] {
  const { byCategory } = loadIndex();
  return byCategory.get(category.substring(0, 3)) || [];
}

/** Validate a specific ICD code exists */
export function isValidIcdCode(code: string): boolean {
  const { byCode } = loadIndex();
  return byCode.has(code);
}

/** Get the description for a specific code */
export function getIcdDescription(code: string): string | undefined {
  const { byCode } = loadIndex();
  return byCode.get(code);
}

/**
 * Build a compact ICD reference string for the LLM prompt.
 * Only includes categories from the given hints, limited per category.
 */
export function buildIcdReferenceForConcepts(
  categoryHints: string[],
  maxPerCategory = 10,
): string {
  const lines: string[] = [];
  const seen = new Set<string>();

  for (const hint of categoryHints) {
    const entries = getEntriesByCategory(hint);
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
