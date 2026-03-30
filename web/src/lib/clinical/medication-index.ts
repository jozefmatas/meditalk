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
