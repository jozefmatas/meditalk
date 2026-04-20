import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { MedicationEntry } from "./types";

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

/** Get all medications with a specific active ingredient */
export function getMedicationsByActiveIngredient(
  activeIngredient: string,
  locale = "en",
): MedicationEntry[] {
  const { byActiveIngredient } = loadIndex(locale);
  const key = activeIngredient.toLowerCase();
  return byActiveIngredient.get(key) || [];
}

/** Validate a specific medication name exists */
export function isValidMedication(name: string, locale = "en"): boolean {
  const { byName } = loadIndex(locale);
  return byName.has(name.toLowerCase());
}

/** Get the active ingredient for a specific medication */
export function getMedicationActiveIngredient(
  name: string,
  locale = "en",
): string | undefined {
  const { byName } = loadIndex(locale);
  const entry = byName.get(name.toLowerCase());
  return entry?.activeIngredient;
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
export function fuzzySearchMedications(
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
 * Attempt to correct a misspelled medication name using fuzzy matching.
 * Returns the best match if similarity >= 0.7, otherwise null.
 *
 * Used by fact validation to auto-correct transcription errors like
 * "Koprenesa 5 mg/25 mg" → "Co-Prenessa 4 mg /1,25 mg".
 */
export function correctMedicationName(
  name: string,
  locale = "en",
): { correctedName: string; entry: MedicationEntry } | null {
  // First try exact match — no correction needed
  if (isValidMedication(name, locale)) return null;

  // Try substring match first (cheaper)
  const substringMatches = searchMedications(name, 1, locale);
  if (substringMatches.length > 0) {
    return {
      correctedName: substringMatches[0].name,
      entry: substringMatches[0],
    };
  }

  // Fuzzy match with higher threshold (0.7) for auto-correction
  const fuzzyMatches = fuzzySearchMedications(name, 1, locale, 0.7);
  if (fuzzyMatches.length > 0) {
    return {
      correctedName: fuzzyMatches[0].name,
      entry: fuzzyMatches[0],
    };
  }

  return null;
}

/**
 * Correct a misspelled medication BASE name only — never returns the full
 * CSV product name with dosage. This is the safe alternative to
 * `correctMedicationName()` that prevents dosage fabrication.
 *
 * "Koprenesa" → { correctedBaseName: "Co-Prenessa", entry: ... }
 * "Rytmonorm" → null (already valid)
 *
 * Unlike `correctMedicationName()` which returns "Co-Prenessa 4 mg /1,25 mg",
 * this returns only "Co-Prenessa" — the caller preserves the original
 * dosage/frequency from the fact value.
 */
export function correctMedicationBaseName(
  name: string,
  locale = "en",
): { correctedBaseName: string; entry: MedicationEntry } | null {
  // Check if the base name itself is already a valid medication base name
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
    return {
      correctedBaseName: extractBaseName(substringMatches[0].name),
      entry: substringMatches[0],
    };
  }

  // Fuzzy match with higher threshold (0.7) for auto-correction
  const fuzzyMatches = fuzzySearchMedications(baseName, 1, locale, 0.7);
  if (fuzzyMatches.length > 0) {
    return {
      correctedBaseName: extractBaseName(fuzzyMatches[0].name),
      entry: fuzzyMatches[0],
    };
  }

  return null;
}

/**
 * Resolve multiple medication names to their active ingredients in bulk.
 * Returns found status for each medication.
 */
export function resolveMedications(
  names: string[],
  locale = "en",
): Array<MedicationEntry & { found: boolean }> {
  const { byName } = loadIndex(locale);
  return names.map((inputName) => {
    const entry = byName.get(inputName.toLowerCase());
    if (entry) {
      return { ...entry, found: true };
    }
    return { name: inputName, activeIngredient: "", found: false };
  });
}

/**
 * Build a compact medication reference string for the LLM prompt.
 * Returns a sample of medications for common conditions/active ingredients.
 */
export function buildMedicationReferenceForConcepts(
  activeIngredientHints: string[],
  maxPerIngredient = 5,
  locale = "en",
): string {
  const lines: string[] = [];
  const seen = new Set<string>();

  for (const hint of activeIngredientHints) {
    const medications = getMedicationsByActiveIngredient(hint, locale);
    let count = 0;
    for (const med of medications) {
      if (seen.has(med.name.toLowerCase())) continue;
      seen.add(med.name.toLowerCase());
      lines.push(`${med.name} (${med.activeIngredient})`);
      count++;
      if (count >= maxPerIngredient) break;
    }
  }

  return lines.join("\n");
}
