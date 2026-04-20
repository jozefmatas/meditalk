/**
 * Medication strength validation.
 *
 * After the base drug name has been validated / auto-corrected (see
 * `medication-index.ts` + `medication-normalizer.ts`), we still need to
 * catch transcription errors in the DOSE — e.g. "Atacand 500 mg" when the
 * real strengths are 8 / 16 / 32 mg.
 *
 * Strategy:
 *  - Collect every strength variant of the given base drug from the CSV
 *    (a separate `byBaseName` index built on first use, cached per locale).
 *  - Normalize both sides (lowercase, comma→dot, collapse whitespace) so
 *    "2,5 mg" in the CSV matches "2.5 mg" from the source.
 *  - Decide a verdict:
 *      * `ok`         — strength matches or no dose was stated
 *      * `suspicious` — drug exists but no matching strength
 *      * `unknown`    — drug not in CSV (caller handles separately)
 *
 * We never DROP medication facts for a strength mismatch — dropping a drug
 * the patient is actually taking is more dangerous than keeping an
 * incorrect dose and letting the doctor verify. Verdict is surfaced as a
 * warning only.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { extractBaseName } from "./medication-index";
import type { MedicationEntry } from "./types";

/** Per-locale cache of base-name → strength variants */
const _baseNameCache = new Map<string, Map<string, Set<string>>>();

/**
 * Dosage-form keywords that mark where the strength substring ends in a
 * CSV medication name (e.g. "Amlessa 8 mg/10 mg tablety" → strength
 * "8 mg/10 mg", form "tablety").
 */
const DOSAGE_FORM_KEYWORDS = [
  "tableta",
  "tablety",
  "tbl",
  "kapsul",
  "kaps",
  "prášok",
  "prasok",
  "prášek",
  "prasek",
  "roztok",
  "suspenzia",
  "suspenze",
  "sirup",
  "kvapky",
  "kapky",
  "krém",
  "krem",
  "krém",
  "mast",
  "gel",
  "gél",
  "čapík",
  "capik",
  "čípek",
  "cipek",
  "sprej",
  "náplast",
  "naplast",
  "injek",
  "infúz",
  "infuz",
  "granulát",
  "granulat",
  "pero",
  "plus",
  "koncentrát",
  "koncentrat",
  "film",
  "filmom",
  "potahovan",
  "pot\u00e1hnuté",
  "potahnut",
];

/**
 * Extract the strength substring from a full CSV medication name.
 *
 * "Atacand 16 mg"                    → "16 mg"
 * "Atacand Plus 16/12,5 mg"          → "16/12,5 mg"
 * "Amlessa 8 mg/10 mg tablety"       → "8 mg/10 mg"
 * "Abilify Maintena 400 mg prášok"   → "400 mg"
 * "Rytmonorm"                        → "" (no strength)
 *
 * Returns the trimmed substring between the base name and the first
 * dosage-form keyword (or end of string). May be empty if no dose given.
 */
function extractStrengthFromName(fullName: string): string {
  const baseName = extractBaseName(fullName);
  const afterBase = fullName.slice(baseName.length).trim();
  if (!afterBase) return "";

  // Cut off at the first dosage-form keyword (case-insensitive)
  const lower = afterBase.toLowerCase();
  let cutAt = afterBase.length;
  for (const kw of DOSAGE_FORM_KEYWORDS) {
    const idx = lower.indexOf(kw);
    if (idx !== -1 && idx < cutAt) cutAt = idx;
  }
  return afterBase.slice(0, cutAt).trim();
}

/**
 * Canonicalize a strength string so comparisons are robust across
 * locale/style differences:
 *  - lowercase
 *  - Slovak/Czech decimal comma → dot
 *  - remove all whitespace (so "2,5 mg" == "2.5mg" == "2.5 mg")
 *  - strip trailing punctuation
 *
 * Returns null if the string has no numeric content at all — those
 * strings cannot meaningfully participate in strength matching.
 */
export function normalizeStrength(raw: string): string | null {
  if (!raw) return null;
  const out = raw
    .toLowerCase()
    .replace(/,/g, ".")
    .replace(/\s+/g, "")
    .replace(/[.,;:]+$/, "");
  if (!out) return null;
  if (!/\d/.test(out)) return null;
  return out;
}

/**
 * Build (or retrieve from cache) a map of base-name → set of normalized
 * strength variants for the given locale. Base names are lowercase keys.
 */
function loadBaseNameIndex(locale: string): Map<string, Set<string>> {
  const cached = _baseNameCache.get(locale);
  if (cached) return cached;

  const csvPath = join(
    process.cwd(),
    "public",
    "medicines",
    locale === "cs" ? "cs" : "sk",
    locale === "cs" ? "medicines_cs.csv" : "medicines_sk.csv",
  );

  const byBase = new Map<string, Set<string>>();
  let raw: string;
  try {
    raw = readFileSync(csvPath, "utf-8");
  } catch {
    // No CSV for this locale — return an empty index. Strength validation
    // will simply report everything as "unknown", which callers treat as
    // "no action" so medication facts survive unchanged.
    _baseNameCache.set(locale, byBase);
    return byBase;
  }

  const lines = raw.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(";");
    if (parts.length < 2) continue;
    const name = parts[0].replace(/^"|"$/g, "").trim();
    if (!name) continue;

    const baseName = extractBaseName(name).toLowerCase();
    if (!baseName) continue;

    const strengthRaw = extractStrengthFromName(name);
    const strengthNorm = normalizeStrength(strengthRaw);
    if (!strengthNorm) continue;

    let set = byBase.get(baseName);
    if (!set) {
      set = new Set<string>();
      byBase.set(baseName, set);
    }
    set.add(strengthNorm);
  }

  _baseNameCache.set(locale, byBase);
  return byBase;
}

/**
 * Return all known strengths for a given drug base name in the supplied
 * locale. Returns an empty array if the drug isn't in the CSV.
 * The returned array preserves insertion order from the CSV and contains
 * the normalized strength strings (see `normalizeStrength`).
 */
export function getValidStrengthsForBase(
  baseName: string,
  locale = "sk",
): string[] {
  if (!baseName) return [];
  const index = loadBaseNameIndex(locale);
  const set = index.get(baseName.toLowerCase());
  return set ? Array.from(set) : [];
}

export type StrengthVerdict =
  | { ok: true; reason: "no_dose_stated" | "strength_matches" | "drug_unknown" }
  | {
      ok: false;
      severity: "suspicious";
      reason: "invalid_strength";
      baseName: string;
      inputStrength: string;
      validStrengths: string[];
    };

/**
 * Validate that the extracted dose is a known strength of the base drug.
 *
 * Verdict semantics:
 *  - `ok: true, reason: "no_dose_stated"`    — no dose present; nothing to check
 *  - `ok: true, reason: "drug_unknown"`      — base drug not in CSV; skip
 *  - `ok: true, reason: "strength_matches"`  — dose matches a known variant
 *  - `ok: false, severity: "suspicious"`     — drug known, dose is not a
 *    real strength — caller should warn, NOT drop.
 *
 * This function NEVER recommends dropping a medication fact — even an
 * implausible strength is safer surfaced to the doctor than silently
 * removed.
 */
export function validateMedicationStrength(
  baseName: string,
  dose: string | undefined,
  locale = "sk",
): StrengthVerdict {
  // No dose stated — nothing to validate.
  if (!dose || !dose.trim()) {
    return { ok: true, reason: "no_dose_stated" };
  }

  const normalizedDose = normalizeStrength(dose);
  if (!normalizedDose) {
    // Dose string had no numeric content — treat same as no dose.
    return { ok: true, reason: "no_dose_stated" };
  }

  const valid = getValidStrengthsForBase(baseName, locale);
  if (valid.length === 0) {
    // Drug unknown in CSV — upstream name correction already warned;
    // we don't pile on.
    return { ok: true, reason: "drug_unknown" };
  }

  // Match either exactly or as a prefix (so "2.5mg/1.25mg" matches
  // CSV "2.5mg/1.25mg" — identical — and a caller asking about
  // just "16mg" against a combo "16mg/12.5mg" doesn't wrongly pass).
  if (valid.includes(normalizedDose)) {
    return { ok: true, reason: "strength_matches" };
  }

  return {
    ok: false,
    severity: "suspicious",
    reason: "invalid_strength",
    baseName,
    inputStrength: dose.trim(),
    validStrengths: valid,
  };
}

/** Convenience: reset the per-locale cache (test helper). */
export function __resetMedicationStrengthCache(): void {
  _baseNameCache.clear();
}

/** Exported for tests. */
export function __internal_extractStrengthFromName(fullName: string): string {
  return extractStrengthFromName(fullName);
}

/** Summary helper used by MedicationEntry-aware callers (unused for now). */
export function summarizeEntriesByStrength(
  entries: MedicationEntry[],
): Map<string, MedicationEntry[]> {
  const map = new Map<string, MedicationEntry[]>();
  for (const e of entries) {
    const s = normalizeStrength(extractStrengthFromName(e.name));
    if (!s) continue;
    const arr = map.get(s) ?? [];
    arr.push(e);
    map.set(s, arr);
  }
  return map;
}
