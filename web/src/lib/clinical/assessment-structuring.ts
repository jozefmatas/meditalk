/**
 * Structured assessment / Záver builder.
 *
 * Produces a `StructuredAssessment` with four hard buckets from the
 * resolver's candidate ICD list and the validated fact set:
 *
 *   - primary       — working/final acute diagnosis (usually 0 or 1 item)
 *   - secondary     — active coexisting diagnoses for this encounter
 *   - chronic       — chronic comorbidities / relevant history
 *   - differential  — uncertain / rule-out / "vs" items
 *
 * The deterministic renderer then emits Slovak (or Czech / English)
 * section headings in a fixed order, omits empty buckets, and never
 * mixes categories. This replaces the old flat "- CODE description"
 * list that was feeding the "Záver is a diagnosis dump" regression.
 *
 * The module is pure TypeScript — no LLM calls. Same inputs → same
 * output every run.
 */

import type { SupportedLanguage } from "../types";
import type { ExtractedFacts, ExtractedFact } from "./fact-extraction";
import type { CandidateIcdCode } from "./types";
import type { ResolvedIcdCode } from "./diagnosis-resolver";
import { normalizeIcdDescription } from "./icd-index";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One bucket within a structured assessment. */
export type AssessmentBucket =
  | "primary"
  | "secondary"
  | "chronic"
  | "differential";

/** A single diagnosis item inside a bucket. */
export interface ResolvedDiagnosisItem {
  /** Display label (clinically cleaned — no "?", "v.s." prefixes, etc.). */
  label: string;
  /** ICD-10 code when mapped (dotted format as stored in CSV). */
  icdCode?: string;
  /** Stable fact ids the diagnosis was derived from (provenance trail). */
  evidenceFactIds?: string[];
  /** How this item was produced — drives rendering + further filtering. */
  sourceType?: "resolved" | "mapped" | "historical" | "differential";
}

export interface StructuredAssessment {
  primary: ResolvedDiagnosisItem[];
  secondary: ResolvedDiagnosisItem[];
  chronic: ResolvedDiagnosisItem[];
  differential: ResolvedDiagnosisItem[];
}

// ---------------------------------------------------------------------------
// Label normalization + uncertainty detection
// ---------------------------------------------------------------------------

/**
 * Normalize a free-form diagnosis label for dedup + matching. Lowercase,
 * strip brackets/punctuation, collapse whitespace. Diacritics are handled
 * by the shared `normalizeIcdDescription` helper to avoid introducing a
 * second normalization path.
 */
export function normalizeDiagnosisLabel(input: string): string {
  return normalizeIcdDescription(input.replace(/[\[\](){}]/g, " "));
}

/** Substrings / signals that mark an item as differential-diagnostic. */
const UNCERTAINTY_MARKERS = [
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
  "nemozno vyluč",
  "nemozno vyluc",
  "nemožno vylúč",
  "nemozno vylucit",
  "suspected",
  "suspekt",
  "?",
];

/** Substrings that mark an item as historical / chronic status-post. */
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
  "pred ",
];

/** Substrings signalling a chronic condition (kept in `chronic` bucket). */
const CHRONIC_MARKERS = [
  "chronic",
  "chronick",
  "chronick",
  "hypertenzia",
  "hypertenzie",
  "hypertension",
  "hypotyre",
  "hypotyreoz",
  "hypothyroid",
  "diabetes",
  "osteoporos",
  "dyslipid",
  "hyperlipid",
  "hyperchol",
  "osteoartr",
  "gerd",
  "asthma",
  "ast",
  "copd",
  "choc",
  "kompenzovan",
];

function containsAny(haystack: string, needles: readonly string[]): boolean {
  for (const n of needles) if (haystack.includes(n)) return true;
  return false;
}

/** Does the label carry any uncertainty / differential marker? */
export function isDifferentialLabel(label: string): boolean {
  const norm = ` ${normalizeDiagnosisLabel(label)} `;
  // Also check the lowercased raw string so markers that contain
  // punctuation survive — "v.s." normalizes to "v s" so we'd lose the
  // dotted variant otherwise.
  const lowerRaw = ` ${label.toLowerCase()} `;
  if (containsAny(norm, UNCERTAINTY_MARKERS)) return true;
  if (containsAny(lowerRaw, UNCERTAINTY_MARKERS)) return true;
  if (/[?]/.test(label)) return true;
  return false;
}

/** Does the label carry any historical / "stav po" marker? */
export function isHistoricalLabel(label: string): boolean {
  const norm = normalizeDiagnosisLabel(label);
  return containsAny(norm, HISTORICAL_MARKERS);
}

/** Does the label carry any chronic-condition marker? */
export function isChronicLabel(label: string): boolean {
  const norm = normalizeDiagnosisLabel(label);
  return containsAny(norm, CHRONIC_MARKERS);
}

// ---------------------------------------------------------------------------
// Bucket classifier
// ---------------------------------------------------------------------------

export interface ClassifyBucketInput {
  label: string;
  canonicalLabel?: string;
  icdCode?: string;
  confidence?: "high" | "medium" | "low" | undefined;
  factCategory?: ExtractedFact["category"];
  /** Whether the fact was a pertinent negative — negatives never bucket anywhere. */
  negated?: boolean;
}

/**
 * Deterministic bucket assignment. Never looks at free-text narrative
 * beyond the label itself — so the resolver is the single source of
 * truth for category, not the downstream renderer.
 *
 * Precedence:
 *   1. differential markers  (vs / versus / ? / rule out / …)
 *   2. historical markers    (stav po / post-op)              → chronic
 *   3. personalHistory origin                                 → chronic
 *   4. chronic markers in label                               → chronic
 *   5. acute-code pattern (I21.x, I60-I63, J81, K35…)         → primary
 *   6. everything else (active, non-specific)                 → secondary
 */
export function classifyDiagnosisBucket(
  input: ClassifyBucketInput,
): AssessmentBucket {
  const label = input.label;

  // 1. Differential / uncertainty markers are the strongest signal.
  if (isDifferentialLabel(label)) return "differential";
  if (input.canonicalLabel && isDifferentialLabel(input.canonicalLabel)) {
    return "differential";
  }

  // 2. Historical phrasing → chronic (never primary/secondary).
  if (isHistoricalLabel(label)) return "chronic";

  // 3. Origin of the underlying fact: personalHistory facts produce
  //    chronic-bucket items by construction.
  if (input.factCategory === "personalHistory") return "chronic";

  // 4. Explicit chronic markers in the label.
  if (isChronicLabel(label)) return "chronic";

  // 5. Acute-code pattern check — any ICD code we consider an acute
  //    working diagnosis. Kept tight and conservative.
  if (input.icdCode && isAcuteCode(input.icdCode)) return "primary";

  // 6. Default: active secondary diagnosis.
  return "secondary";
}

/**
 * ICD codes that represent an acute / working diagnosis. We key off the
 * 3-char category prefix and list the subset clinically considered
 * "acute emergency" or "acute in-encounter". Very conservative.
 */
const ACUTE_CATEGORY_PREFIXES = new Set<string>([
  "I20", // Angina pectoris (usually acute)
  "I21", // Acute myocardial infarction
  "I22", // Subsequent MI
  "I23", // Complications following MI
  "I24", // Other acute ischaemic heart disease
  "I26", // Pulmonary embolism
  "I46", // Cardiac arrest
  "I60", // Subarachnoid haemorrhage
  "I61", // Intracerebral haemorrhage
  "I62", // Other nontraumatic intracranial haemorrhage
  "I63", // Cerebral infarction
  "I74", // Arterial embolism and thrombosis
  "J81", // Pulmonary oedema
  "J96", // Respiratory failure
  "K35", // Acute appendicitis
  "K81", // Acute cholecystitis
  "K85", // Acute pancreatitis
  "N10", // Acute pyelonephritis
  "N17", // Acute kidney failure
]);

function isAcuteCode(code: string): boolean {
  const cat = code.replace(/\./g, "").toUpperCase().substring(0, 3);
  return ACUTE_CATEGORY_PREFIXES.has(cat);
}

// ---------------------------------------------------------------------------
// Building + cleaning
// ---------------------------------------------------------------------------

export interface BuildStructuredAssessmentOptions {
  /**
   * Validated facts — used to resolve historical-facts (from personalHistory)
   * into chronic-bucket items and to check whether a given ICD code's
   * evidence came from a non-diagnostic category.
   */
  facts?: ExtractedFacts;
}

/**
 * Build a StructuredAssessment from the resolver's candidate codes.
 *
 * Accepts any `CandidateIcdCode`-compatible list; extra fields present
 * on `ResolvedIcdCode` (matchType, factIds, canonicalDescription) are
 * preserved so the renderer / observability can use them.
 */
export function buildStructuredAssessment(
  codes: CandidateIcdCode[] | ResolvedIcdCode[],
  options: BuildStructuredAssessmentOptions = {},
): StructuredAssessment {
  const facts = options.facts;
  const out: StructuredAssessment = {
    primary: [],
    secondary: [],
    chronic: [],
    differential: [],
  };

  // Build a map from fact id → fact so we can look up the origin category.
  const factById = new Map<string, ExtractedFact>();
  if (facts) {
    facts.diagnoses.forEach((f, i) => factById.set(`diagnoses-${i}`, f));
    facts.personalHistory.forEach((f, i) =>
      factById.set(`personalHistory-${i}`, f),
    );
  }

  for (const code of codes) {
    const resolved = code as ResolvedIcdCode;
    const label = resolved.canonicalDescription ?? code.description;
    const factIds = resolved.factIds ?? [];
    const originCategory = inferOriginCategory(factIds, factById);
    const bucket = classifyDiagnosisBucket({
      label,
      canonicalLabel: resolved.canonicalDescription,
      icdCode: code.code,
      confidence: code.confidence,
      factCategory: originCategory,
    });
    const item: ResolvedDiagnosisItem = {
      label,
      icdCode: code.code,
      evidenceFactIds: factIds.length > 0 ? factIds : undefined,
      sourceType:
        bucket === "differential"
          ? "differential"
          : bucket === "chronic"
            ? "historical"
            : "resolved",
    };
    out[bucket].push(item);
  }

  return cleanStructuredAssessment(out);
}

function inferOriginCategory(
  factIds: string[],
  factById: Map<string, ExtractedFact>,
): ExtractedFact["category"] | undefined {
  for (const id of factIds) {
    const fact = factById.get(id);
    if (fact) return fact.category;
  }
  return undefined;
}

/**
 * Dedup + filter pass on a `StructuredAssessment`. Removes speculative
 * items from primary/secondary/chronic, dedupes across buckets by ICD
 * code and normalized label (higher-priority bucket wins), and drops
 * category-incompatible items from the main conclusion.
 */
export function cleanStructuredAssessment(
  input: StructuredAssessment,
): StructuredAssessment {
  const bucketOrder: AssessmentBucket[] = [
    "primary",
    "secondary",
    "chronic",
    "differential",
  ];

  // 1. Remove speculative items from primary/secondary/chronic — they
  //    must only ever appear under differential.
  const mainBuckets: AssessmentBucket[] = ["primary", "secondary", "chronic"];
  for (const b of mainBuckets) {
    const moved: ResolvedDiagnosisItem[] = [];
    input[b] = input[b].filter((it) => {
      if (isDifferentialLabel(it.label)) {
        moved.push({ ...it, sourceType: "differential" });
        return false;
      }
      return true;
    });
    input.differential.push(...moved);
  }

  // 2. "stav po" / historical phrasing is not allowed in primary/secondary.
  //    Move to chronic (which already accepts historical items).
  const historicalOnly: AssessmentBucket[] = ["primary", "secondary"];
  for (const b of historicalOnly) {
    const moved: ResolvedDiagnosisItem[] = [];
    input[b] = input[b].filter((it) => {
      if (isHistoricalLabel(it.label)) {
        moved.push({ ...it, sourceType: "historical" });
        return false;
      }
      return true;
    });
    input.chronic.push(...moved);
  }

  // 3. Dedupe across buckets — by ICD code first, then by normalized
  //    label. Higher-priority bucket wins.
  const seenCodes = new Set<string>();
  const seenLabels = new Set<string>();
  for (const b of bucketOrder) {
    const kept: ResolvedDiagnosisItem[] = [];
    for (const it of input[b]) {
      const codeKey = it.icdCode
        ? it.icdCode.replace(/\./g, "").toUpperCase()
        : "";
      const labelKey = normalizeDiagnosisLabel(it.label);
      if (codeKey && seenCodes.has(codeKey)) continue;
      if (!codeKey && labelKey && seenLabels.has(labelKey)) continue;
      if (codeKey) seenCodes.add(codeKey);
      if (labelKey) seenLabels.add(labelKey);
      kept.push(it);
    }
    input[b] = kept;
  }

  // 4. Collapse overlapping differential when a final diagnosis already
  //    exists in primary. e.g. "Diferenciálne diagnosticky NSTEMI" when
  //    I21.4 NSTEMI is already primary — drop the differential.
  if (input.primary.length > 0) {
    const primaryNormalized = new Set(
      input.primary.map((it) => normalizeDiagnosisLabel(it.label)),
    );
    input.differential = input.differential.filter((it) => {
      const norm = normalizeDiagnosisLabel(it.label);
      for (const prim of primaryNormalized) {
        // loose overlap — if either contains the other, treat as duplicate
        if (prim.includes(norm) || norm.includes(prim)) return false;
      }
      return true;
    });
  }

  // 5. Acute-coronary precedence. When primary contains a confirmed
  //    myocardial infarction (I21.x), drop the redundant weaker
  //    coronary descriptors from ANY bucket — I20.x (angina),
  //    I24.x (other acute IHD), I25.x (chronic IHD) and the R07.x /
  //    R42 symptom codes. These describe the same clinical event at
  //    a less specific level and only clutter Záver.
  //
  //    Exception: I21.x variants themselves can coexist in primary
  //    (e.g. dual-site infarct) — we only collapse the LOWER categories.
  const primaryHasMI = input.primary.some(
    (it) => icdCategoryPrefix(it.icdCode) === "I21",
  );
  if (primaryHasMI) {
    const redundantWhenMI = new Set(["I20", "I24", "I25", "R07", "R42"]);
    const filterRedundant = (it: ResolvedDiagnosisItem): boolean =>
      !redundantWhenMI.has(icdCategoryPrefix(it.icdCode));
    input.primary = input.primary.filter(filterRedundant);
    input.secondary = input.secondary.filter(filterRedundant);
    // Keep them in differential (as "also considered") but drop from
    // primary/secondary so the main conclusion is clean.
  }

  // 6. At most ONE primary item per acute category. If primary still
  //    contains multiple I21.x entries after dedup (e.g. both I21.3
  //    "transmural, site unspecified" and I21.4 "subendocardial"), keep
  //    the one with the highest specificity — a dotted subcode wins
  //    over the 3-char parent, and the first in insertion order breaks
  //    any remaining tie (deterministic, no LLM).
  if (input.primary.length > 1) {
    input.primary = dedupByAcuteCategory(input.primary);
  }

  // 7. Drop items whose label is obviously malformed — CSV debris
  //    from a mapper bug ("R07.4-Description", or a trailing quote
  //    mid-label). We don't want these shipping regardless of bucket.
  const isMalformed = (it: ResolvedDiagnosisItem): boolean =>
    isMalformedLabel(it.label);
  input.primary = input.primary.filter((it) => !isMalformed(it));
  input.secondary = input.secondary.filter((it) => !isMalformed(it));
  input.chronic = input.chronic.filter((it) => !isMalformed(it));
  input.differential = input.differential.filter((it) => !isMalformed(it));

  return input;
}

/**
 * Return the 3-char category prefix ("I21", "E11", etc.) of an ICD
 * code, or the empty string for items without a code.
 */
function icdCategoryPrefix(code: string | undefined): string {
  if (!code) return "";
  return code.replace(/\./g, "").toUpperCase().substring(0, 3);
}

/**
 * When multiple items fall in the same acute ICD category (e.g. I21.x),
 * keep only the most specific one. Codes with a subtype (dotted) win
 * over the parent; among subtypes, insertion order wins — keeping the
 * behavior fully deterministic without trying to rank subtypes
 * clinically.
 */
function dedupByAcuteCategory(
  items: ResolvedDiagnosisItem[],
): ResolvedDiagnosisItem[] {
  const ACUTE_PREFIXES = ["I21", "I22", "I23", "I60", "I61", "I62", "I63"];
  const byCategory = new Map<string, ResolvedDiagnosisItem>();
  const kept: ResolvedDiagnosisItem[] = [];
  for (const it of items) {
    const prefix = icdCategoryPrefix(it.icdCode);
    if (!ACUTE_PREFIXES.includes(prefix)) {
      kept.push(it);
      continue;
    }
    const existing = byCategory.get(prefix);
    if (!existing) {
      byCategory.set(prefix, it);
      continue;
    }
    // Prefer the more specific entry (has a dot in the code).
    const currentIsSpecific = it.icdCode?.includes(".") ?? false;
    const existingIsSpecific = existing.icdCode?.includes(".") ?? false;
    if (currentIsSpecific && !existingIsSpecific) {
      byCategory.set(prefix, it);
    }
    // Otherwise keep `existing` (insertion order wins).
  }
  return [...byCategory.values(), ...kept];
}

/**
 * Detect diagnosis labels that are clearly corrupt — usually CSV row
 * fragments leaked from a mapper bug. Pure syntactic check — no
 * semantic knowledge required.
 */
function isMalformedLabel(label: string): boolean {
  if (!label) return true;
  // Trailing ",R07.4-Description" or similar embedded ICD-CSV row.
  if (/"\s*,\s*[A-Z]\d{2}(?:\.\d+)?\s*-/.test(label)) return true;
  // An ICD-code hyphen pattern embedded mid-label (real labels never
  // contain "R07.4-Bolesť" — the hyphen belongs to the CSV format).
  if (/\b[A-Z]\d{2}\.\d+\s*-\s*[A-Za-z]/.test(label)) return true;
  // A dangling double-quote in the middle or end of the label.
  if (/"\s*,/.test(label) || /,\s*"$/.test(label)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Deterministic rendering
// ---------------------------------------------------------------------------

const HEADINGS: Record<SupportedLanguage, Record<AssessmentBucket, string>> = {
  sk: {
    primary: "Hlavná diagnóza",
    secondary: "Vedľajšie diagnózy",
    chronic: "Chronické ochorenia",
    differential: "Diferenciálna diagnostika",
  },
  cs: {
    primary: "Hlavní diagnóza",
    secondary: "Vedlejší diagnózy",
    chronic: "Chronická onemocnění",
    differential: "Diferenciální diagnostika",
  },
  en: {
    primary: "Primary diagnosis",
    secondary: "Secondary diagnoses",
    chronic: "Chronic conditions",
    differential: "Differential diagnoses",
  },
};

export interface RenderStructuredAssessmentOptions {
  language?: SupportedLanguage;
}

/**
 * Render a StructuredAssessment as deterministic section text. Slovak
 * headings by default (matching the primary user locale), with Czech /
 * English variants available. Empty buckets are omitted entirely.
 */
export function renderStructuredAssessment(
  input: StructuredAssessment,
  options: RenderStructuredAssessmentOptions = {},
): string {
  const lang = options.language ?? "sk";
  const headings = HEADINGS[lang];
  const order: AssessmentBucket[] = [
    "primary",
    "secondary",
    "chronic",
    "differential",
  ];
  const blocks: string[] = [];
  for (const bucket of order) {
    const items = input[bucket];
    if (items.length === 0) continue;
    const lines = [headings[bucket]];
    for (const it of items) {
      if (it.icdCode) {
        lines.push(`${it.icdCode} ${it.label}`);
      } else {
        lines.push(it.label);
      }
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

/**
 * True when at least one bucket has items — callers use this to gate
 * the "structured path" against an empty resolver.
 */
export function hasStructuredContent(input: StructuredAssessment): boolean {
  return (
    input.primary.length +
      input.secondary.length +
      input.chronic.length +
      input.differential.length >
    0
  );
}
