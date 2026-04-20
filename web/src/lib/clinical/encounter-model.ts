/**
 * EncounterModel — the single source of truth for a generated note.
 *
 * Every validated fact + every resolved ICD code feeds into one typed
 * object that then drives every renderer. No downstream stage is
 * allowed to re-classify, re-bucket, or re-route clinical meaning.
 *
 * Architecture:
 *
 *   Stage 1  Extract       Haiku        → RawFacts
 *   Stage 2  Validate      pure TS      → ValidatedFacts
 *   Stage 3  Model build   pure TS      → EncounterModel   ← this file
 *   Stage 4  Plan + Render pure TS+LLM  → SectionedContent
 *   Stage 5  Verify        pure TS      → FinalContent
 *
 * The model builder consumes validated facts + candidate ICD codes and
 * produces a shape that mirrors clinical reasoning: history vs current
 * encounter vs objective findings vs chronic background. Each diagnosis
 * carries its evidence trail (fact ids) and its bucket (primary /
 * secondary / chronic / differential). The builder is the ONE place
 * where this classification happens.
 */

import type { SupportedLanguage } from "../types";
import type { ExtractedFact, ExtractedFacts } from "./fact-extraction";
import type { CandidateIcdCode } from "./types";
import type { ResolvedIcdCode } from "./diagnosis-resolver";
import { parseMeasurement, type MeasurementKind } from "./numeric-sanity";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Stable reference to a validated fact — what every model slot holds. */
export interface FactRef {
  /** `${category}-${index}` — stable across the pipeline. */
  id: string;
  /** Fact value as the renderer will display it. */
  value: string;
  /** Origin category from Pass 1.5. */
  category: ExtractedFact["category"];
  /** Source provenance (transcript chunk / doctor notes / file index). */
  source: ExtractedFact["source"];
  /** Pertinent negative ("no dyspnea"). */
  negated?: boolean;
}

/** A diagnosis item inside a problem bucket. */
export interface ProblemItem {
  /** Display label — canonical description from CSV when available. */
  label: string;
  /** ICD-10 code (dotted format, matching the locale CSV). */
  icdCode?: string;
  /** Fact ids that evidence this diagnosis. Empty means no grounding. */
  evidenceFactIds: string[];
  /** Certainty level. */
  certainty: "final" | "working" | "differential";
  /** Clinical priority in this encounter. */
  priority: "encounter-driving" | "active-supporting" | "chronic";
}

export interface EncounterModel {
  language: SupportedLanguage;
  visitDate?: string;

  /** Historical / standing facts that don't pertain to this encounter's acute event. */
  history: {
    family: FactRef[];
    personal: FactRef[];
    social: FactRef[];
    work: FactRef[];
    allergies: FactRef[];
    habits: FactRef[];
    medications: FactRef[];
    epidemiological: FactRef[];
  };

  /** What's happening THIS encounter. */
  currentEncounter: {
    /** Present-illness narrative facts (chiefComplaint + symptoms category). */
    hpiFacts: FactRef[];
    /** The encounter-driving problem. Null when no acute working diagnosis. */
    primaryProblem: ProblemItem | null;
    /** Active coexisting diagnoses. */
    supportingProblems: ProblemItem[];
    /** Differential / "versus" / "rule out" items. */
    differentialProblems: ProblemItem[];
    /** Plan facts (follow-up, procedures ordered, discharge instructions). */
    planItems: FactRef[];
  };

  /** Measurable/structural findings from this encounter's exam. */
  objective: {
    vitals: FactRef[];
    labs: FactRef[];
    examFindings: FactRef[];
    studies: {
      ecg: FactRef[];
      imaging: FactRef[];
      other: FactRef[];
    };
  };

  /** Chronic comorbidities — distinct from primary/secondary (which are acute/active). */
  chronicConditions: ProblemItem[];
}

// ---------------------------------------------------------------------------
// Fact id helper (stable across pipeline — also used by diagnosis-resolver)
// ---------------------------------------------------------------------------

/** Stable fact id. Mirrors `diagnosis-resolver.computeFactId`. */
export function factId(
  category: ExtractedFact["category"],
  index: number,
): string {
  return `${category}-${index}`;
}

/** Build a FactRef from an ExtractedFact at a known index within its category. */
function toFactRef(f: ExtractedFact, index: number): FactRef {
  return {
    id: factId(f.category, index),
    value: f.value,
    category: f.category,
    source: f.source,
    ...(f.negated ? { negated: true as const } : {}),
  };
}

// ---------------------------------------------------------------------------
// Diagnosis classification — SINGLE source of truth
// ---------------------------------------------------------------------------

/**
 * Substring markers (diacritic-stripped, lowercased). The SpecialtyPack
 * refactor (Phase 5) will move these out of code; for now they live here
 * so every caller reads one list.
 */
const DIFFERENTIAL_MARKERS = [
  " vs ",
  " vs.",
  "v.s.",
  "versus",
  "diff dg",
  "dif. dg",
  "diferencialne",
  "diferenciálne",
  "diferencialna",
  "diferenciálna",
  "rule out",
  "r/o ",
  "cannot exclude",
  "nemozno vyluc",
  "nemožno vylúč",
  "nemozno vylucit",
  "suspected",
  "suspekt",
];

const HISTORICAL_MARKERS = [
  "stav po",
  "st.p.",
  "stp.",
  "status post",
  "post-",
  "post op",
  "postoperative",
  "history of",
  "anamnest",
];

const CHRONIC_MARKERS = [
  "chronic",
  "chronick",
  "hypertenzia",
  "hypertenzie",
  "hypertension",
  "hypotyre",
  "hypothyroid",
  "diabetes",
  "osteoporos",
  "dyslipid",
  "hyperlipid",
  "hyperchol",
  "osteoartr",
  "gerd",
  "asthma",
  "copd",
  "chocp",
  "kompenzovan",
  "hyperurik",
  "apnoe",
  "mgus",
  "gamapati",
  "artralgi",
  "artroz",
  "artros",
  "regurgitac",
];

/**
 * Acute ICD category prefixes — codes we consider an acute/encounter-
 * driving diagnosis unless the label says otherwise. Conservative list.
 */
const ACUTE_CATEGORY_PREFIXES = new Set<string>([
  "I20",
  "I21",
  "I22",
  "I23",
  "I24",
  "I26",
  "I46",
  "I60",
  "I61",
  "I62",
  "I63",
  "I74",
  "J81",
  "J96",
  "K35",
  "K81",
  "K85",
  "N10",
  "N17",
]);

/** Normalize a string for marker detection (diacritic-insensitive). */
function normalizeForMarkers(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\[\](){}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAny(haystack: string, needles: readonly string[]): boolean {
  for (const n of needles) if (haystack.includes(n)) return true;
  return false;
}

function isDifferentialLabel(label: string): boolean {
  const norm = ` ${normalizeForMarkers(label)} `;
  const lowerRaw = ` ${label.toLowerCase()} `;
  if (containsAny(norm, DIFFERENTIAL_MARKERS)) return true;
  if (containsAny(lowerRaw, DIFFERENTIAL_MARKERS)) return true;
  if (/[?]/.test(label)) return true;
  return false;
}

function isHistoricalLabel(label: string): boolean {
  return containsAny(normalizeForMarkers(label), HISTORICAL_MARKERS);
}

function isChronicLabel(label: string): boolean {
  return containsAny(normalizeForMarkers(label), CHRONIC_MARKERS);
}

function icdCategoryPrefix(code: string | undefined): string {
  if (!code) return "";
  return code.replace(/\./g, "").toUpperCase().substring(0, 3);
}

function isAcuteCode(code: string | undefined): boolean {
  return ACUTE_CATEGORY_PREFIXES.has(icdCategoryPrefix(code));
}

/**
 * Classify an ICD code + its evidence into a (certainty, priority)
 * tuple. Pure function — no external state.
 *
 * Precedence:
 *   1. Differential marker → certainty=differential, priority=active-supporting
 *   2. Historical marker / personalHistory origin → chronic
 *   3. Chronic marker → chronic
 *   4. Acute ICD prefix (I21.x, I60-I63, …) → encounter-driving (final)
 *   5. Default → working, active-supporting
 */
export function classifyProblem(input: {
  label: string;
  icdCode?: string;
  factOriginCategory?: ExtractedFact["category"];
}): { certainty: ProblemItem["certainty"]; priority: ProblemItem["priority"] } {
  const { label, icdCode, factOriginCategory } = input;

  if (isDifferentialLabel(label)) {
    return { certainty: "differential", priority: "active-supporting" };
  }

  if (isHistoricalLabel(label) || factOriginCategory === "personalHistory") {
    return { certainty: "final", priority: "chronic" };
  }

  if (isChronicLabel(label)) {
    return { certainty: "final", priority: "chronic" };
  }

  if (isAcuteCode(icdCode)) {
    return { certainty: "final", priority: "encounter-driving" };
  }

  return { certainty: "working", priority: "active-supporting" };
}

// ---------------------------------------------------------------------------
// Problem-list building (ICD resolver output → ProblemItem[])
// ---------------------------------------------------------------------------

/**
 * Collapse multiple candidate codes + their evidence into a typed
 * problem list. One `ProblemItem` per unique ICD code (dot-stripped
 * key). Lower-priority entries are merged into higher-priority ones
 * — e.g. a differential "Nestabilná angina pectoris" for I20.0 merges
 * into a supporting ProblemItem if the same code later classifies as
 * supporting (but never downgrades from final).
 */
function buildProblemList(
  codes: CandidateIcdCode[] | ResolvedIcdCode[],
  factIndexMap: Map<string, ExtractedFact["category"]>,
): ProblemItem[] {
  const byKey = new Map<string, ProblemItem>();

  for (const code of codes) {
    const resolved = code as ResolvedIcdCode;
    const label = resolved.canonicalDescription ?? code.description;
    // The fact evidence ids come from `resolver.factIds` when set, else
    // empty. No evidence → certainty degrades later (or we drop it).
    const evidenceFactIds = resolved.factIds ?? [];
    const factOriginCategory = evidenceFactIds
      .map((id) => factIndexMap.get(id))
      .find((c): c is ExtractedFact["category"] => Boolean(c));

    const { certainty, priority } = classifyProblem({
      label,
      icdCode: code.code,
      factOriginCategory,
    });

    const key = code.code.replace(/\./g, "").toUpperCase();
    const existing = byKey.get(key);
    if (existing) {
      // Merge evidence, keep the stronger certainty/priority.
      const mergedEvidence = Array.from(
        new Set([...existing.evidenceFactIds, ...evidenceFactIds]),
      );
      const stronger = strongerProblem(existing, {
        label,
        icdCode: code.code,
        evidenceFactIds: mergedEvidence,
        certainty,
        priority,
      });
      byKey.set(key, stronger);
    } else {
      byKey.set(key, {
        label,
        icdCode: code.code,
        evidenceFactIds,
        certainty,
        priority,
      });
    }
  }

  return Array.from(byKey.values());
}

/** Which ProblemItem takes precedence when two resolve to the same code. */
function strongerProblem(a: ProblemItem, b: ProblemItem): ProblemItem {
  // certainty order: final > working > differential
  const certaintyRank = { final: 3, working: 2, differential: 1 } as const;
  // priority order: encounter-driving > active-supporting > chronic
  const priorityRank = {
    "encounter-driving": 3,
    "active-supporting": 2,
    chronic: 1,
  } as const;

  if (certaintyRank[b.certainty] > certaintyRank[a.certainty]) return b;
  if (certaintyRank[a.certainty] > certaintyRank[b.certainty]) return a;
  if (priorityRank[b.priority] > priorityRank[a.priority]) return b;
  return a;
}

// ---------------------------------------------------------------------------
// Objective grouping — explicit, no inference downstream
// ---------------------------------------------------------------------------

const VITAL_KINDS: ReadonlySet<MeasurementKind> = new Set([
  "bp",
  "hr",
  "rr",
  "spo2",
  "temp_c",
  "gcs",
]);

const LAB_KINDS: ReadonlySet<MeasurementKind> = new Set([
  "glucose_mmol",
  "glucose_mgdl",
]);

const EKG_KEYWORD_REGEX =
  /\bekg\b|\becg\b|elektrokardio|electrocardio|\brytmus\b|\brhythm\b|\bsr\b\s|\bsf\b|\bst\b\s*(?:elevac|depres|elevat|depres)|\bqrs\b|qtc\b|av\s*blok/i;

const IMAGING_KEYWORD_REGEX =
  /\brtg\b|\brontgen\b|\bxray\b|x-ray|\bct\b|\bmri\b|\bmr\b|\bmrt\b|\bultrazvuk\b|\busg\b|\becho\b|\btte\b|echokardio|sonograf|angiograf/i;

/**
 * Lab-test keywords — matches common cardiology / internal-medicine
 * lab names as they appear in Slovak / Czech / English reports, plus
 * the numeric-unit pattern (`ng/l`, `mg/l`, `g/l`, `U/l`, `IU/l`,
 * `mmol/l`, `μg/ml`) which is a strong signal for a quantitative lab.
 */
const LAB_KEYWORD_REGEX =
  /\btnt\b|\btni\b|hs[-\s]?tnt|hsctnt|troponin|nt[-\s]?probnp|probnp|\bbnp\b|d[-\s]?dimer|\bcrp\b|fibrinog|myoglob|\bquick\b|\binr\b|hba1c|kreatini[ck]|\bgfr\b|\bnatri[eé]m|\bk\+|\bkali[eé]m|chlorid|albumin|bilirubin|alt\b|\bast\b|alkalin|\bldh\b|leukocyt|trombocyt|hemoglob|\s(\d+[,.]?\d*)\s*(?:ng|mg|g|ng\/l|mg\/l|g\/l|U\/l|IU\/l|mmol\/l|μmol\/l|umol\/l|μg\/ml|mcg\/ml)\b/i;

function classifyObjectiveFact(
  fact: ExtractedFact,
): "vitals" | "labs" | "ecg" | "imaging" | "exam" | "other" {
  if (fact.category === "measurements") {
    const parsed = parseMeasurement(fact.value);
    if (parsed) {
      if (VITAL_KINDS.has(parsed.kind)) return "vitals";
      if (LAB_KINDS.has(parsed.kind)) return "labs";
    }
    // Numeric-looking but neither vital nor lab → keep with labs by default
    // (troponin, NT-proBNP, CRP, etc. fall here and behave like labs).
    return "labs";
  }
  if (fact.category === "findings") {
    if (EKG_KEYWORD_REGEX.test(fact.value)) return "ecg";
    if (IMAGING_KEYWORD_REGEX.test(fact.value)) return "imaging";
    if (LAB_KEYWORD_REGEX.test(fact.value)) return "labs";
    return "exam";
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export interface BuildEncounterModelInput {
  language: SupportedLanguage;
  visitDate?: string;
  facts: ExtractedFacts;
  candidateIcdCodes: CandidateIcdCode[] | ResolvedIcdCode[];
}

/**
 * Turn validated facts + candidate ICD codes into a fully typed
 * EncounterModel. Pure function — no IO, no LLM, no mutation of inputs.
 */
export function buildEncounterModel(
  input: BuildEncounterModelInput,
): EncounterModel {
  const { language, visitDate, facts, candidateIcdCodes } = input;

  const asRefs = (list: ExtractedFact[]): FactRef[] =>
    list.map((f, i) => toFactRef(f, i));

  // Build a fact-id → origin-category index once for problem classification.
  const factIndexMap = new Map<string, ExtractedFact["category"]>();
  for (const cat of [
    "diagnoses",
    "personalHistory",
    "symptoms",
    "findings",
    "chiefComplaint",
    "medications",
  ] as const) {
    facts[cat].forEach((f, i) => factIndexMap.set(factId(cat, i), cat));
  }

  // Objective grouping — partition `findings` + `measurements` into slots.
  const vitals: FactRef[] = [];
  const labs: FactRef[] = [];
  const examFindings: FactRef[] = [];
  const ecg: FactRef[] = [];
  const imaging: FactRef[] = [];
  const otherStudies: FactRef[] = [];

  const mlen = facts.measurements.length;
  facts.measurements.forEach((f, i) => {
    const ref = toFactRef(f, i);
    switch (classifyObjectiveFact(f)) {
      case "vitals":
        vitals.push(ref);
        break;
      case "labs":
        labs.push(ref);
        break;
      default:
        examFindings.push(ref);
    }
  });
  void mlen;

  facts.findings.forEach((f, i) => {
    const ref = toFactRef(f, i);
    switch (classifyObjectiveFact(f)) {
      case "ecg":
        ecg.push(ref);
        break;
      case "imaging":
        imaging.push(ref);
        break;
      case "labs":
        labs.push(ref);
        break;
      case "vitals":
        vitals.push(ref);
        break;
      case "other":
        otherStudies.push(ref);
        break;
      default:
        examFindings.push(ref);
    }
  });

  // Build the problem list from candidate ICDs.
  const problems = buildProblemList(candidateIcdCodes, factIndexMap);

  const primaryCandidates = problems.filter(
    (p) => p.certainty === "final" && p.priority === "encounter-driving",
  );
  // Keep at most ONE primary — use the first specific (dotted) code, then
  // fall back to insertion order. The structured-cleanup logic that used
  // to live in assessment-structuring lives here now.
  const primaryProblem = pickPrimary(primaryCandidates);

  const supportingProblems = problems.filter(
    (p) =>
      p.certainty !== "differential" &&
      p.priority === "active-supporting" &&
      (!primaryProblem || p.icdCode !== primaryProblem.icdCode) &&
      !isRedundantWithPrimary(p, primaryProblem),
  );

  const chronicConditions = problems.filter((p) => p.priority === "chronic");

  const differentialProblems = problems.filter(
    (p) =>
      p.certainty === "differential" &&
      !isLooseOverlapWithPrimary(p, primaryProblem),
  );

  return {
    language,
    visitDate,
    history: {
      family: asRefs(facts.familyHistory),
      personal: asRefs(facts.personalHistory),
      social: asRefs(facts.socialHistory),
      work: asRefs(facts.workHistory),
      allergies: [],
      habits: asRefs(facts.substanceUse),
      medications: asRefs(facts.medications).filter((r) => !r.negated),
      epidemiological: asRefs(facts.epidemiologicalHistory),
    },
    currentEncounter: {
      hpiFacts: [...asRefs(facts.chiefComplaint), ...asRefs(facts.symptoms)],
      primaryProblem,
      supportingProblems,
      differentialProblems,
      planItems: asRefs(facts.plan),
    },
    objective: {
      vitals,
      labs,
      examFindings,
      studies: {
        ecg,
        imaging,
        other: otherStudies,
      },
    },
    chronicConditions,
  };
}

function pickPrimary(candidates: ProblemItem[]): ProblemItem | null {
  if (candidates.length === 0) return null;
  // Prefer a dotted subcode over a 3-char parent of the same category.
  const byCategory = new Map<string, ProblemItem>();
  for (const c of candidates) {
    const prefix = icdCategoryPrefix(c.icdCode);
    if (!prefix) continue;
    const existing = byCategory.get(prefix);
    if (!existing) {
      byCategory.set(prefix, c);
      continue;
    }
    const currentIsSpecific = c.icdCode?.includes(".") ?? false;
    const existingIsSpecific = existing.icdCode?.includes(".") ?? false;
    if (currentIsSpecific && !existingIsSpecific) byCategory.set(prefix, c);
  }
  // Return the first category's winner; if multiple acute categories
  // produced candidates, we pick the FIRST in the original list's order.
  for (const c of candidates) {
    const prefix = icdCategoryPrefix(c.icdCode);
    const winner = byCategory.get(prefix);
    if (winner) return winner;
  }
  return candidates[0];
}

/**
 * When primary is an I21.x (MI), we consider I20.x, I24.x, I25.x,
 * R07.x, R42 redundant — they describe the same clinical event at a
 * less specific level.
 */
function isRedundantWithPrimary(
  p: ProblemItem,
  primary: ProblemItem | null,
): boolean {
  if (!primary) return false;
  if (icdCategoryPrefix(primary.icdCode) !== "I21") return false;
  const REDUNDANT_WHEN_MI = new Set(["I20", "I24", "I25", "R07", "R42"]);
  return REDUNDANT_WHEN_MI.has(icdCategoryPrefix(p.icdCode));
}

/**
 * Normalize for loose overlap comparison — used to suppress differential
 * items that describe the same diagnosis as the primary in different
 * words (e.g. "Diferenciálne diagnosticky NSTEMI" when primary is
 * "Akútny subendokardiálny infarkt myokardu").
 */
function normalizeForOverlap(s: string): string {
  return normalizeForMarkers(s);
}

function isLooseOverlapWithPrimary(
  p: ProblemItem,
  primary: ProblemItem | null,
): boolean {
  if (!primary) return false;
  const a = normalizeForOverlap(p.label);
  const b = normalizeForOverlap(primary.label);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}
