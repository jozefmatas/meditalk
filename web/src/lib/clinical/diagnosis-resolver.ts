/**
 * Diagnosis resolver — Pass 1.65.
 *
 * Fixes two long-standing pain points:
 *
 *  1. **ICD inconsistency across runs** — the legacy pipeline asked Sonnet
 *     to suggest `candidateIcdCodes`. Even at temperature 0, GPU float
 *     math makes the output non-deterministic, so the same encounter
 *     can produce different ICD codes on different runs.
 *  2. **Critical-path latency** — waiting for Sonnet (~10–15 s) before
 *     streaming could begin was the main cause of the dead-silence gap
 *     between transcript and first rendered line.
 *
 * This module resolves ICD codes DIRECTLY from validated diagnosis facts,
 * using only deterministic rules:
 *
 *  1. **Synonym table** — a tight dictionary of common abbreviations and
 *     short forms doctors use ("STEMI", "HTN", "DM2") that never appear
 *     verbatim in the CSV. Each synonym maps to a canonical description
 *     + ICD code and produces a high-confidence match.
 *  2. **Exact description lookup** — `lookupIcdByDescription` checks the
 *     normalized fact value against the CSV's own descriptions (diacritic-
 *     and punctuation-insensitive). Exact hits are high confidence.
 *  3. **Fuzzy search** — `searchIcd` falls back to substring matching. A
 *     hit whose tokens overlap ≥ 60% with the fact value is medium
 *     confidence; anything below is treated as no match.
 *
 * Every resolved code carries `factIds` — stable `"${category}-${index}"`
 * references to the validated facts that produced it. Codes without any
 * fact trail never exit the resolver. This is the evidence trail the
 * plan asks for: "no evidence → excluded".
 *
 * The resolver is pure and dependency-free beyond the ICD index. It is
 * safe to call in parallel with Sonnet — the caller decides whether to
 * use its output as the PRIMARY source or as a supplement.
 */

import type { SupportedLanguage } from "../types";
import type { ExtractedFacts, ExtractedFact } from "./fact-extraction";
import type { CandidateIcdCode, IcdEntry } from "./types";
import {
  lookupIcdByDescription,
  normalizeIcdDescription,
  searchIcdNormalized,
} from "./icd-index";

/** One fact's contribution to an ICD match — used to compose `factIds`. */
function factId(category: string, index: number): string {
  return `${category}-${index}`;
}

/** Stable fact id used downstream for provenance tracking in the UI. */
export function computeFactId(fact: ExtractedFact, index: number): string {
  return factId(fact.category, index);
}

/** A single ICD code resolved deterministically from validated facts. */
export interface ResolvedIcdCode extends CandidateIcdCode {
  /** Stable IDs of the facts that produced this code ("${category}-${index}"). */
  factIds: string[];
  /** How the resolver matched: which strategy produced the code. */
  matchType: "synonym" | "exact_description" | "fuzzy_description";
  /** Canonical description in the target locale (from the CSV). */
  canonicalDescription: string;
}

export interface DiagnosisResolutionResult {
  /** Codes with fact-level provenance, deduplicated by ICD code. */
  codes: ResolvedIcdCode[];
  /** Diagnosis facts that couldn't be resolved to a code — excluded by design. */
  unresolved: Array<{ factId: string; value: string }>;
}

// ---------------------------------------------------------------------------
// Curated synonyms
// ---------------------------------------------------------------------------

/**
 * Abbreviations and short forms doctors use in clinical speech but that
 * never appear verbatim in the ICD-10 CSV. Each key is a normalized form
 * (diacritic-stripped, lowercased, alphanumeric only — see
 * `normalizeIcdDescription`). Keep this list tight and clinically
 * conservative: a WRONG match here is worse than no match.
 */
interface SynonymEntry {
  icd: string;
  canonical: string;
}

const DIAGNOSIS_SYNONYMS: Record<
  SupportedLanguage,
  Record<string, SynonymEntry>
> = {
  sk: {
    // STEMI without a wall location defaults to I21.3 (transmural, site
    // unspecified) rather than I21.0 (anterior wall) — the wall-specific
    // subcodes should only be emitted when the fact explicitly names the
    // wall (e.g. "STEMI prednej steny" → I21.0).
    stemi: {
      icd: "I21.3",
      canonical:
        "Akútny transmurálny infarkt myokardu bez bližšieho určenia miesta",
    },
    "stemi prednej steny": {
      icd: "I21.0",
      canonical: "Akútny transmurálny infarkt myokardu prednej steny",
    },
    "stemi spodnej steny": {
      icd: "I21.1",
      canonical: "Akútny transmurálny infarkt myokardu spodnej steny",
    },
    "stemi lateralnej steny": {
      icd: "I21.2",
      canonical: "Akútny transmurálny infarkt myokardu na iných miestach",
    },
    nstemi: {
      icd: "I21.4",
      canonical: "Akútny subendokardiálny infarkt myokardu",
    },
    htn: {
      icd: "I10",
      canonical: "Primárna [esenciálna] artériová hypertenzia",
    },
    "arterialna hypertenzia": {
      icd: "I10",
      canonical: "Primárna [esenciálna] artériová hypertenzia",
    },
    hypertenzia: {
      icd: "I10",
      canonical: "Primárna [esenciálna] artériová hypertenzia",
    },
    dm2: {
      icd: "E11.9",
      canonical: "Diabetes mellitus 2. typu bez komplikácií",
    },
    "dm 2 typu": {
      icd: "E11.9",
      canonical: "Diabetes mellitus 2. typu bez komplikácií",
    },
    "dm ii": {
      icd: "E11.9",
      canonical: "Diabetes mellitus 2. typu bez komplikácií",
    },
    dm1: {
      icd: "E10.9",
      canonical: "Diabetes mellitus 1. typu bez komplikácií",
    },
    afib: { icd: "I48.0", canonical: "Paroxyzmálna fibrilácia predsiení" },
    "fibrilacia predsieni": {
      icd: "I48.0",
      canonical: "Paroxyzmálna fibrilácia predsiení",
    },
    copd: {
      icd: "J44.9",
      canonical: "Chronická obštrukčná choroba pľúc, bližšie neurčená",
    },
    chocp: {
      icd: "J44.9",
      canonical: "Chronická obštrukčná choroba pľúc, bližšie neurčená",
    },
    acs: {
      icd: "I24.9",
      canonical: "Akútna ischemická choroba srdca bližšie neurčená",
    },
    pe: {
      icd: "I26.9",
      canonical: "Pľúcna embólia bez zmienky o akútnom cor pulmonale",
    },
    dvt: {
      icd: "I80.2",
      canonical:
        "Flebitída a tromboflebitída iných hlbokých ciev dolných končatín",
    },
  },
  cs: {
    stemi: { icd: "I21.0", canonical: "Akutní transmurální infarkt myokardu" },
    nstemi: {
      icd: "I21.4",
      canonical: "Akutní subendokardiální infarkt myokardu",
    },
    htn: { icd: "I10", canonical: "Esenciální arteriální hypertenze" },
    hypertenze: { icd: "I10", canonical: "Esenciální arteriální hypertenze" },
    dm2: {
      icd: "E11.9",
      canonical: "Diabetes mellitus 2. typu bez komplikací",
    },
    afib: { icd: "I48.0", canonical: "Paroxyzmální fibrilace síní" },
  },
  en: {
    stemi: {
      icd: "I21.0",
      canonical: "Acute transmural myocardial infarction",
    },
    nstemi: {
      icd: "I21.4",
      canonical: "Acute subendocardial myocardial infarction",
    },
    htn: { icd: "I10", canonical: "Essential (primary) hypertension" },
    hypertension: { icd: "I10", canonical: "Essential (primary) hypertension" },
    "type 2 diabetes": {
      icd: "E11.9",
      canonical: "Type 2 diabetes mellitus without complications",
    },
    dm2: {
      icd: "E11.9",
      canonical: "Type 2 diabetes mellitus without complications",
    },
    afib: { icd: "I48.0", canonical: "Paroxysmal atrial fibrillation" },
    copd: {
      icd: "J44.9",
      canonical: "Chronic obstructive pulmonary disease, unspecified",
    },
  },
};

/**
 * Try to find a synonym-level match for the given normalized diagnosis
 * value. Returns the curated canonical + ICD code, or null when the value
 * is not a recognized abbreviation.
 */
function resolveSynonym(
  normalized: string,
  locale: SupportedLanguage,
): SynonymEntry | null {
  const table = DIAGNOSIS_SYNONYMS[locale];
  if (!table) return null;
  // Exact normalized match first.
  if (table[normalized]) return table[normalized];
  // Whole-word token match — "stemi lateralna stena" still hits "stemi".
  const tokens = normalized.split(" ").filter((t) => t.length > 0);
  for (const token of tokens) {
    if (table[token]) return table[token];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fuzzy description matching
// ---------------------------------------------------------------------------

function tokenSet(norm: string): Set<string> {
  return new Set(norm.split(" ").filter((t) => t.length >= 3));
}

/**
 * Jaccard-style overlap between a diagnosis value and an ICD description,
 * both normalized. Returns a value in [0, 1].
 */
function descriptionOverlap(
  normValue: string,
  normDescription: string,
): number {
  const a = tokenSet(normValue);
  const b = tokenSet(normDescription);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

/**
 * Fuzzy-match the normalized diagnosis value against the CSV via
 * `searchIcdNormalized` (diacritic-insensitive). The first hit whose
 * token overlap ≥ 0.6 wins; weaker matches are returned as null to
 * avoid confident-looking nonsense.
 *
 * Among candidates meeting the threshold, we return the one with the
 * HIGHEST overlap to prefer specific subcodes (e.g. I21.0) over the
 * parent category (I21) when the fact is a specific diagnosis.
 */
function resolveFuzzy(
  normalized: string,
  locale: SupportedLanguage,
): { entry: IcdEntry; overlap: number } | null {
  // Try the longest token first — it carries the most diagnostic weight
  // (e.g. "hypertenzia" in "arteriálna hypertenzia nekomplikovaná").
  const tokens = normalized
    .split(" ")
    .filter((t) => t.length >= 4)
    .sort((a, b) => b.length - a.length);
  if (tokens.length === 0) return null;

  let best: { entry: IcdEntry; overlap: number } | null = null;
  for (const token of tokens) {
    const hits = searchIcdNormalized(token, locale, 10);
    for (const hit of hits) {
      const normDesc = normalizeIcdDescription(hit.description);
      const overlap = descriptionOverlap(normalized, normDesc);
      if (overlap >= 0.6 && (best === null || overlap > best.overlap)) {
        best = { entry: hit, overlap };
      }
    }
    if (best) break; // first matching token wins; prefer longer tokens
  }
  return best;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Resolve ICD codes deterministically from validated diagnosis facts.
 *
 * The strategy for each diagnosis fact is:
 *  1. Try the curated synonym table (exact / token-level).
 *  2. Try exact CSV-description lookup.
 *  3. Try fuzzy CSV search with a ≥ 0.6 token-overlap gate.
 *  4. If nothing hits, the fact is placed in `unresolved` and produces no
 *     code. The caller can surface this so the doctor can pick manually.
 *
 * Multiple facts can resolve to the same code — the resolver merges them
 * and accumulates `factIds`, which downstream consumers use as the
 * evidence trail ("this code is grounded by facts X, Y, Z").
 */
export function resolveIcdFromFacts(
  facts: ExtractedFacts,
  locale: SupportedLanguage = "en",
): DiagnosisResolutionResult {
  const diagnoses = facts.diagnoses ?? [];
  const byCode = new Map<string, ResolvedIcdCode>();
  const unresolved: DiagnosisResolutionResult["unresolved"] = [];

  diagnoses.forEach((fact, index) => {
    // Pertinent-negative diagnoses ("does not have diabetes") don't
    // produce an ICD code — they document absence, not presence.
    if (fact.negated) return;

    const id = computeFactId(fact, index);
    const normalized = normalizeIcdDescription(fact.value);
    if (!normalized) return;

    // 1. Synonym lookup
    const synonym = resolveSynonym(normalized, locale);
    if (synonym) {
      const existing = byCode.get(synonym.icd);
      if (existing) {
        existing.factIds.push(id);
        existing.sourceConceptIds.push(id);
      } else {
        byCode.set(synonym.icd, {
          code: synonym.icd,
          description: synonym.canonical,
          confidence: "high",
          sourceConceptIds: [id],
          factIds: [id],
          matchType: "synonym",
          canonicalDescription: synonym.canonical,
        });
      }
      return;
    }

    // 2. Exact description lookup
    const exact = lookupIcdByDescription(fact.value, locale);
    if (exact) {
      const existing = byCode.get(exact.code);
      if (existing) {
        existing.factIds.push(id);
        existing.sourceConceptIds.push(id);
      } else {
        byCode.set(exact.code, {
          code: exact.code,
          description: exact.description,
          confidence: "high",
          sourceConceptIds: [id],
          factIds: [id],
          matchType: "exact_description",
          canonicalDescription: exact.description,
        });
      }
      return;
    }

    // 3. Fuzzy
    const fuzzy = resolveFuzzy(normalized, locale);
    if (fuzzy) {
      const existing = byCode.get(fuzzy.entry.code);
      if (existing) {
        existing.factIds.push(id);
        existing.sourceConceptIds.push(id);
        // A fuzzy match shouldn't downgrade a prior high-confidence
        // exact/synonym match for the same code.
      } else {
        byCode.set(fuzzy.entry.code, {
          code: fuzzy.entry.code,
          description: fuzzy.entry.description,
          confidence: fuzzy.overlap >= 0.8 ? "high" : "medium",
          sourceConceptIds: [id],
          factIds: [id],
          matchType: "fuzzy_description",
          canonicalDescription: fuzzy.entry.description,
        });
      }
      return;
    }

    // 4. No match
    unresolved.push({ factId: id, value: fact.value });
  });

  return {
    codes: Array.from(byCode.values()),
    unresolved,
  };
}
