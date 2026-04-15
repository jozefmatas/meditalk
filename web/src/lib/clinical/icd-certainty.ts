/**
 * Pass 1.7 — Diagnosis Certainty Filter for ICD Codes.
 *
 * After Pass 1 (clinical analysis) emits a list of candidate ICD-10
 * codes and Pass 1.5 extracts + validates + resolves clinical facts,
 * this module intersects the two: a candidate ICD code is only kept if
 * it is lexically grounded in at least one validated `diagnoses` or
 * history fact (familyHistory, personalHistory, etc.). Anything else is
 * dropped before it ever reaches the
 * Opus generator prompt.
 *
 * Why this exists:
 *   Pass 1 (Sonnet 4.6 temperature 0) is NOT strictly deterministic,
 *   and its prompt allows ICD codes "based on clinical context" — which
 *   means labs and symptoms can promote a related code into the
 *   candidate list even when the doctor never diagnosed that condition.
 *   Opus is then free to include or omit those weak candidates
 *   arbitrarily, producing different Záver/Assessment lists on each run.
 *
 *   This filter is rule-based and 100% deterministic. Same inputs →
 *   same output every run. It decouples final ICD output from upstream
 *   LLM noise.
 *
 * Core rule:
 *   A candidate ICD code is CERTAIN iff at least one token from a
 *   grounding fact substring-matches the normalized ICD description,
 *   OR a token from the ICD description substring-matches a grounding
 *   fact value. An ICD code is also instantly grounded if its literal
 *   code string (e.g. "I10") appears in any grounding fact value.
 *
 *   Grounding scope depends on the ICD chapter:
 *   - Non-R codes (disease codes): ALL fact categories contribute
 *     EXCEPT demographics and measurements. This is necessary because
 *     Haiku often categorizes conditions under symptoms, findings, or
 *     medications rather than diagnoses.
 *   - R-chapter codes (symptom/sign codes R00-R99): STRICT grounding
 *     via diagnoses + history subcategories only. This prevents "chest
 *     pain" (symptom fact) from promoting R07.2 while allowing it to
 *     promote I21.4 (disease code).
 *
 * Stem matching:
 *   Tokens longer than 6 chars are truncated to a 6-char stem so
 *   Slavic inflection (hypertenzia/hypertenzie, hypertenze) matches the
 *   same stem (`hypert`). This is crude but works across sk/cs/en
 *   without per-locale wiring.
 *
 * Synonym matching:
 *   Stem matching handles inflection but NOT synonyms. Slovak/Czech
 *   layperson terms often share zero lexical overlap with formal ICD
 *   descriptions ("krvný tlak" vs "hypertenzia"). A small curated
 *   synonym table maps between these, so a fact containing "tlak"
 *   can ground ICD codes mentioning "hypert*" and vice versa.
 *   False positives are gated by Pass 1's code selection — synonyms
 *   only help codes that Pass 1 already identified as candidates.
 */
import type { CandidateIcdCode } from "./types";
import type { ExtractedFacts } from "./fact-extraction";
import { normalizeForMatch } from "./fact-validator";
import { logger } from "@/lib/logger";

/** Reason a candidate ICD code was dropped by the certainty filter. */
export type DropReason = "no_diagnosis_facts" | "no_matching_token";

export interface DroppedIcdCandidate {
  candidate: CandidateIcdCode;
  reason: DropReason;
}

export interface CertaintyFilterResult {
  kept: CandidateIcdCode[];
  dropped: DroppedIcdCandidate[];
  counts: {
    total: number;
    kept: number;
    dropped: number;
  };
}

/**
 * Stop words across sk/cs/en in normalized form (diacritics stripped,
 * lowercased). Anything on this list cannot contribute to grounding.
 * Keep this tight — overly aggressive filtering will strip real
 * clinical content.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  // Slovak/Czech prepositions and conjunctions
  "a",
  "na",
  "v",
  "vo",
  "s",
  "so",
  "pre",
  "pro",
  "pri",
  "za",
  "od",
  "do",
  "po",
  "bez",
  "k",
  "u",
  "o",
  "z",
  "ze",
  "i",
  "aj",
  "ale",
  "je",
  "sa",
  "ma",
  "byt",
  "typu",
  "typ",
  // English prepositions and articles
  "of",
  "the",
  "an",
  "and",
  "or",
  "with",
  "without",
  "in",
  "on",
  "to",
  "for",
  "by",
  "at",
  "as",
  "is",
  "are",
  "be",
]);

/**
 * Clinical abbreviations that should match despite being <4 chars.
 * These are commonly dictated shorthand that carries real diagnostic
 * weight and must not be filtered out as noise.
 */
const CLINICAL_ABBREVS: ReadonlySet<string> = new Set([
  "im", // infarkt myokardu
  "ht", // hypertenzia/hypertension
  "dm", // diabetes mellitus
  "cv", // cardiovascular
  "tia", // transient ischemic attack
  "cmp", // cévní mozková příhoda
  "ibs", // ischemická choroba srdca
  "ami", // acute myocardial infarction
  "cabg",
  "pci",
  "copd",
  "chopn",
  "astma",
  "asthma",
  "stemi",
  "nstemi",
  "acs", // acute coronary syndrome
  "mi", // myocardial infarction
  "chf", // congestive heart failure
  "afib",
]);

/**
 * Stem length for substring matching. Tokens longer than this are
 * truncated from the right so inflected forms still match a common
 * prefix (e.g. `hypertenzia`, `hypertenzie`, `hypertenze`, `hypertension`
 * all share `hypert`).
 */
const STEM_LENGTH = 6;

/**
 * Clinical synonym groups for bridging layperson ↔ medical terminology.
 * Each group contains normalized stems (≤ STEM_LENGTH chars) that are
 * clinically equivalent. If a token's stem matches any entry in a group,
 * all other entries become additional substring-match candidates.
 *
 * Why this is needed:
 *   Slovak/Czech layperson terms share zero lexical overlap with formal
 *   ICD descriptions. "krvný tlak" (blood pressure) → stem "tlak" has
 *   no overlap with "hypertenzia" → stem "hypert". The synonym group
 *   ["tlak", "hypert"] bridges this gap.
 *
 * Safety:
 *   False positives are gated by Pass 1 — synonyms only help codes that
 *   Pass 1 already selected. A fact about "atmosférický tlak" won't
 *   promote I10 unless Pass 1 independently suggested I10 for that
 *   encounter (which it wouldn't).
 *
 * Keep this table tight. Only add pairs where the lexical gap causes
 * real production drops.
 */
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["tlak", "hypert", "tenzie"], // krvný tlak ↔ hypertenzia/hypertenze/hypertension
  ["cukrov", "diabet"], // cukrovka ↔ diabetes mellitus
  ["zaval", "infark"], // srdcový zával ↔ infarkt myokardu
  ["mrtvic", "porazk"], // mŕtvica/porážka ↔ CMP (stroke)
  ["astma", "asthma"], // astma (SK/CZ) ↔ asthma (EN)
];

/**
 * Precomputed stem → synonym stems lookup.
 * Built once at module load from SYNONYM_GROUPS.
 */
const SYNONYM_LOOKUP: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const group of SYNONYM_GROUPS) {
    for (const term of group) {
      const others = group.filter((t) => t !== term);
      const existing = map.get(term);
      if (existing) {
        map.set(term, [...existing, ...others]);
      } else {
        map.set(term, [...others]);
      }
    }
  }
  return map;
})();

/**
 * Extract clinical content tokens from a piece of text. Splits on
 * whitespace after Unicode normalization, drops stop words, and drops
 * tokens shorter than 4 characters unless they are on the clinical
 * abbreviation whitelist. Exported for unit testing.
 *
 * Locale-agnostic: `normalizeForMatch` (NFKD + diacritic strip) handles
 * sk / cs / en uniformly, and the stop word + abbreviation lists cover
 * all three languages in a single set.
 */
export function extractContentTokens(text: string): string[] {
  if (!text) return [];
  const normalized = normalizeForMatch(text);
  if (!normalized) return [];
  return normalized
    .split(" ")
    .filter((t) => t.length > 0)
    .filter((t) => !STOP_WORDS.has(t))
    .filter((t) => t.length >= 4 || CLINICAL_ABBREVS.has(t));
}

/** Reduce a token to its matching stem (first N characters). */
function stem(token: string): string {
  return token.length > STEM_LENGTH ? token.slice(0, STEM_LENGTH) : token;
}

/**
 * Does any token from `aText` substring-match (after stemming) anywhere
 * in the normalized `bText`? Used bidirectionally — fact tokens against
 * ICD description, and ICD description tokens against fact value.
 *
 * Also checks clinical synonyms: if a stemmed token has entries in
 * SYNONYM_LOOKUP, those synonym stems are tested as additional
 * substring-match candidates against bText.
 */
function tokensOverlapStemmed(aText: string, bText: string): boolean {
  const aTokens = extractContentTokens(aText);
  if (aTokens.length === 0) return false;
  const bNormalized = normalizeForMatch(bText);
  if (!bNormalized) return false;
  for (const token of aTokens) {
    const s = stem(token);
    if (!s) continue;
    if (bNormalized.includes(s)) return true;
    // Synonym expansion: if this stem has clinical synonyms, check those
    const synonyms = SYNONYM_LOOKUP.get(s);
    if (synonyms) {
      for (const syn of synonyms) {
        if (bNormalized.includes(syn)) return true;
      }
    }
  }
  return false;
}

/**
 * Is this candidate ICD code grounded in clinical facts?
 *
 * Grounding scope:
 *   - Non-R codes (disease codes I, E, J, K, …): ALL categories except
 *     demographics and measurements. Haiku frequently categorizes
 *     conditions under symptoms, findings, or medications rather than
 *     diagnoses — excluding those categories caused ALL codes to be
 *     dropped in production.
 *   - R-chapter codes (R00-R99 symptom/sign codes): STRICT grounding
 *     via diagnoses + history only. Prevents "chest pain" in symptoms
 *     from promoting R07.2 while disease codes like I21.4 remain free
 *     to match via any category.
 *
 * Additionally, if the literal ICD code string (e.g. "I10", "I21.4")
 * appears in any grounding fact value, the candidate is instantly
 * grounded — doctors often dictate codes directly.
 */
function isCandidateGrounded(
  candidate: CandidateIcdCode,
  facts: ExtractedFacts,
): boolean {
  const isRChapter = candidate.code.startsWith("R");

  // R-chapter: strict grounding (diagnoses + history only)
  // Non-R: broad grounding (all except demographics + measurements)
  const groundingFacts = isRChapter
    ? [
        ...facts.diagnoses,
        ...facts.familyHistory,
        ...facts.personalHistory,
        ...facts.socialHistory,
        ...facts.workHistory,
        ...facts.substanceUse,
        ...facts.epidemiologicalHistory,
      ]
    : [
        ...facts.diagnoses,
        ...facts.chiefComplaint,
        ...facts.symptoms,
        ...facts.findings,
        ...facts.medications,
        ...facts.procedures,
        ...facts.plan,
        ...facts.familyHistory,
        ...facts.personalHistory,
        ...facts.socialHistory,
        ...facts.workHistory,
        ...facts.substanceUse,
        ...facts.epidemiologicalHistory,
      ];
  if (groundingFacts.length === 0) return false;

  // Check 1: Direct ICD code match — if any fact value mentions the
  // code itself (e.g. "diagnóza I10", "dg. I21.4"), instant grounding.
  const codeNorm = normalizeForMatch(candidate.code);
  if (codeNorm) {
    for (const fact of groundingFacts) {
      const factNorm = normalizeForMatch(fact.value);
      if (factNorm && factNorm.includes(codeNorm)) return true;
    }
  }

  // Check 2: Bidirectional stem matching
  for (const fact of groundingFacts) {
    // Direction 1: fact tokens → ICD description
    if (tokensOverlapStemmed(fact.value, candidate.description)) {
      return true;
    }
    // Direction 2: ICD description tokens → fact value
    if (tokensOverlapStemmed(candidate.description, fact.value)) {
      return true;
    }
  }

  return false;
}

/**
 * Filter a candidate ICD list down to codes that are lexically grounded
 * in at least one validated diagnosis or history-subcategory fact. Pure function —
 * does not mutate inputs.
 *
 * Locale-agnostic: the underlying matcher uses NFKD normalization which
 * handles sk / cs / en uniformly.
 *
 * Returns a telemetry object with the kept list, dropped candidates +
 * reasons, and counts for logging.
 */
export function filterCertainIcdCandidates(
  candidates: CandidateIcdCode[],
  facts: ExtractedFacts,
): CertaintyFilterResult {
  const kept: CandidateIcdCode[] = [];
  const dropped: DroppedIcdCandidate[] = [];

  // Any fact category except demographics/measurements can contribute
  // to grounding (for non-R codes). If there are zero such facts,
  // every candidate is dropped with `no_diagnosis_facts`.
  const hasGroundingFacts =
    facts.diagnoses.length > 0 ||
    facts.chiefComplaint.length > 0 ||
    facts.symptoms.length > 0 ||
    facts.findings.length > 0 ||
    facts.medications.length > 0 ||
    facts.procedures.length > 0 ||
    facts.plan.length > 0 ||
    facts.familyHistory.length > 0 ||
    facts.personalHistory.length > 0 ||
    facts.socialHistory.length > 0 ||
    facts.workHistory.length > 0 ||
    facts.substanceUse.length > 0 ||
    facts.epidemiologicalHistory.length > 0;

  for (const candidate of candidates) {
    if (!hasGroundingFacts) {
      dropped.push({ candidate, reason: "no_diagnosis_facts" });
      continue;
    }
    if (isCandidateGrounded(candidate, facts)) {
      kept.push(candidate);
    } else {
      dropped.push({ candidate, reason: "no_matching_token" });
    }
  }

  if (dropped.length > 0) {
    logger.debug(
      `[icd-certainty] dropped ${dropped.length}/${candidates.length} candidate ICD code(s)`,
      dropped.slice(0, 10).map((d) => ({
        code: d.candidate.code,
        description: d.candidate.description,
        confidence: d.candidate.confidence,
        reason: d.reason,
      })),
    );
  }

  return {
    kept,
    dropped,
    counts: {
      total: candidates.length,
      kept: kept.length,
      dropped: dropped.length,
    },
  };
}
