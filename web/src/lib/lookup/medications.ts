import { readFileSync, existsSync } from "fs";
import { join } from "path";

/** Medication entry from the CSV index. */
export interface MedicationEntry {
  name: string;
  activeIngredient: string;
}

interface MedicationIndex {
  byName: Map<string, MedicationEntry>;
  byActiveIngredient: Map<string, MedicationEntry[]>;
}

/** Per-locale cache */
const _cache = new Map<string, MedicationIndex>();

/** Map locale to CSV filename */
function csvFileForLocale(locale: string): string {
  switch (locale) {
    case "sk": {
      const skPath = join(
        process.cwd(),
        "public",
        "medicines",
        "sk",
        "medicines_sk.csv",
      );
      if (existsSync(skPath)) return "medicines_sk.csv";
      return "medicines_sk.csv"; // fallback
    }
    case "cs": {
      const csPath = join(
        process.cwd(),
        "public",
        "medicines",
        "cs",
        "medicines_cs.csv",
      );
      if (existsSync(csPath)) return "medicines_cs.csv";
      return "medicines_sk.csv"; // fallback to SK
    }
    default:
      return "medicines_sk.csv";
  }
}

/**
 * Lazily load and parse a medications CSV for the given locale.
 * CSV format: "Medication Name";"Active Ingredient";;;
 */
function loadIndex(locale = "en"): MedicationIndex {
  const cached = _cache.get(locale);
  if (cached) return cached;

  const filename = csvFileForLocale(locale);
  const csvPath = join(
    process.cwd(),
    "public",
    "medicines",
    locale === "cs" ? "cs" : "sk",
    filename,
  );

  const raw = readFileSync(csvPath, "utf-8");
  const byName = new Map<string, MedicationEntry>();
  const byActiveIngredient = new Map<string, MedicationEntry[]>();

  const lines = raw.split("\n");
  // Skip header row
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Split by semicolon
    const parts = line.split(";");
    if (parts.length < 2) continue;

    const name = parts[0].replace(/^"|"$/g, "").trim();
    const activeIngredient = parts[1].replace(/^"|"$/g, "").trim();

    if (!name || !activeIngredient) continue;

    const entry: MedicationEntry = { name, activeIngredient };

    // Index by medication name (case-insensitive key)
    const nameKey = name.toLowerCase();
    byName.set(nameKey, entry);

    // Index by active ingredient
    const ingredientKey = activeIngredient.toLowerCase();
    const arr = byActiveIngredient.get(ingredientKey) || [];
    arr.push(entry);
    byActiveIngredient.set(ingredientKey, arr);
  }

  const index = { byName, byActiveIngredient };
  _cache.set(locale, index);
  return index;
}

/** Validate a specific medication name exists */
export function isValidMedication(name: string, locale = "en"): boolean {
  const { byName } = loadIndex(locale);
  return byName.has(name.toLowerCase());
}

/** Check if a string is a known active ingredient in the CSV. */
export function isActiveIngredient(name: string, locale = "en"): boolean {
  const { byActiveIngredient } = loadIndex(locale);
  return byActiveIngredient.has(name.toLowerCase().trim());
}

/**
 * Look up the active (INN / generic) ingredient for a medication brand
 * name. Used by the drug-normalizer for generic-level deduplication —
 * so "TRITACE" and "Ramipril Actavis" both resolve to "ramipril" and
 * the LA dedup collapses them.
 *
 * CSV entries store the full strength-qualified name ("TRITACE 5",
 * "Ramipril Actavis 10 mg") so an exact lookup of just the brand
 * ("TRITACE") misses. We try in order:
 *   1. Exact case-insensitive match.
 *   2. First entry whose name STARTS with the brand (same INN holds
 *      across all strengths of one brand).
 *
 * Returns the active ingredient lowercased + trimmed, ready to use as
 * a dedup fingerprint. Null when nothing matches.
 */
export function getActiveIngredient(
  brand: string,
  locale = "en",
): string | null {
  const { byName } = loadIndex(locale);
  const key = brand.toLowerCase().trim();
  if (!key) return null;

  const exact = byName.get(key);
  if (exact) return exact.activeIngredient.toLowerCase().trim();

  const prefix = key + " ";
  for (const [nameKey, entry] of byName) {
    if (nameKey.startsWith(prefix)) {
      return entry.activeIngredient.toLowerCase().trim();
    }
  }
  return null;
}

/**
 * Search medications by name or active ingredient.
 * Prioritizes exact name matches, then name substring matches, then active ingredient matches.
 */
export function searchMedications(
  query: string,
  limit = 20,
  locale = "en",
): MedicationEntry[] {
  const { byName, byActiveIngredient } = loadIndex(locale);
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const exactMatches: MedicationEntry[] = [];
  const nameMatches: MedicationEntry[] = [];
  const ingredientMatches: MedicationEntry[] = [];
  const seen = new Set<string>();

  // 1. Check for exact medication name match
  const exactEntry = byName.get(q);
  if (exactEntry) {
    exactMatches.push(exactEntry);
    seen.add(exactEntry.name.toLowerCase());
  }

  // 2. Search by medication name (starts with or contains)
  for (const [key, entry] of byName) {
    if (exactMatches.length + nameMatches.length >= limit) break;
    if (seen.has(entry.name.toLowerCase())) continue;

    if (key.startsWith(q)) {
      nameMatches.push(entry);
      seen.add(entry.name.toLowerCase());
    } else if (key.includes(q)) {
      nameMatches.push(entry);
      seen.add(entry.name.toLowerCase());
    }
  }

  // 3. Search by active ingredient
  for (const [key, entries] of byActiveIngredient) {
    if (
      exactMatches.length + nameMatches.length + ingredientMatches.length >=
      limit
    )
      break;

    if (key.includes(q)) {
      for (const entry of entries) {
        if (
          exactMatches.length + nameMatches.length + ingredientMatches.length >=
          limit
        )
          break;
        if (seen.has(entry.name.toLowerCase())) continue;

        ingredientMatches.push(entry);
        seen.add(entry.name.toLowerCase());
      }
    }
  }

  return [...exactMatches, ...nameMatches, ...ingredientMatches].slice(
    0,
    limit,
  );
}

// ── Fuzzy medication matching ─────────────────────────────────────────
// Handles misspellings from transcription (e.g. "Koprenesa" → "Co-Prenessa").

/**
 * Extract the base drug name before dosage/strength info.
 * "Co-Prenessa 4 mg /1,25 mg" → "Co-Prenessa"
 * "Amlessa 8 mg/10 mg tablety" → "Amlessa"
 */
export function extractBaseName(fullName: string): string {
  // Cut at the first digit or "mg"/"ml"/"tbl" marker
  const match = fullName.match(/^(.*?)(?:\s+\d|\s+mg|\s+ml|\s+tbl)/i);
  return (match ? match[1] : fullName).trim();
}

/**
 * Normalize a string for fuzzy comparison: lowercase, strip non-letters.
 * "Co-Prenessa" → "coprenessa", "Koprenesa" → "koprenesa"
 */
function normalizeForFuzzy(name: string): string {
  return name.toLowerCase().replace(/[^a-záäčďéěíľňóôřšťúůýžüöß]/gi, "");
}

/**
 * Compute Levenshtein edit distance between two strings.
 * Used for fuzzy medication name matching.
 */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) matrix[i] = [i];
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

/**
 * Fuzzy search for medications by name similarity.
 * Handles transcription misspellings like "Koprenesa" → "Co-Prenessa".
 *
 * Returns matches sorted by similarity (highest first), only above the
 * threshold (default 0.65 — allows ~35% of the name to differ).
 */
function fuzzySearchMedications(
  query: string,
  limit = 3,
  locale = "en",
  threshold = 0.65,
): Array<MedicationEntry & { similarity: number }> {
  const { byName } = loadIndex(locale);

  const queryBase = normalizeForFuzzy(extractBaseName(query));
  if (queryBase.length < 3) return []; // too short for meaningful fuzzy match

  const matches: Array<MedicationEntry & { similarity: number }> = [];
  const seen = new Set<string>();

  for (const [, entry] of byName) {
    const entryBase = normalizeForFuzzy(extractBaseName(entry.name));
    if (entryBase.length < 3) continue;

    const dist = levenshtein(queryBase, entryBase);
    const maxLen = Math.max(queryBase.length, entryBase.length);
    const similarity = 1 - dist / maxLen;

    if (similarity >= threshold) {
      const key = entry.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({ ...entry, similarity });
    }
  }

  // Sort by similarity descending, then by name length (prefer shorter/simpler)
  matches.sort(
    (a, b) => b.similarity - a.similarity || a.name.length - b.name.length,
  );
  return matches.slice(0, limit);
}

/**
 * Correct a misspelled medication BASE name only — never returns the full
 * CSV product name with dosage. The caller preserves the original
 * dosage/frequency from the agent output.
 *
 * "Koprenesa" → { correctedBaseName: "Co-Prenessa", entry: ... }
 * "Rytmonorm" → null (already valid)
 */
export function correctMedicationBaseName(
  name: string,
  locale = "en",
): { correctedBaseName: string; entry: MedicationEntry } | null {
  const normalizedName = name.trim();
  if (!normalizedName) return null;

  // First: check if the exact input is already a valid medication key
  if (isValidMedication(normalizedName, locale)) return null;

  // Check if extracting the base name gives us a valid match
  const baseName = extractBaseName(normalizedName);
  if (isValidMedication(baseName, locale)) return null;

  // Try substring match — but return only the base name portion
  const substringMatches = searchMedications(baseName, 1, locale);
  if (substringMatches.length > 0) {
    const corrected = extractBaseName(substringMatches[0].name);
    const correctedLower = corrected.toLowerCase();
    const baseLower = baseName.toLowerCase();
    // Don't "correct" a valid generic/INN name to a branded variant with
    // manufacturer suffix. E.g. "Ramipril" should NOT become "Ramipril
    // Actavis" just because the CSV indexes "Ramipril Actavis 10 mg".
    // The input is a valid prefix — the match is a substring hit, not a
    // genuine typo correction.
    if (
      correctedLower !== baseLower &&
      !correctedLower.startsWith(baseLower + " ")
    ) {
      return { correctedBaseName: corrected, entry: substringMatches[0] };
    }
  }

  // Fuzzy match with higher threshold (0.7) for auto-correction
  const fuzzyMatches = fuzzySearchMedications(baseName, 1, locale, 0.7);
  if (fuzzyMatches.length > 0) {
    const corrected = extractBaseName(fuzzyMatches[0].name);
    const correctedLower = corrected.toLowerCase();
    const baseLower = baseName.toLowerCase();
    if (
      correctedLower !== baseLower &&
      !correctedLower.startsWith(baseLower + " ")
    ) {
      return { correctedBaseName: corrected, entry: fuzzyMatches[0] };
    }
  }

  return null;
}
