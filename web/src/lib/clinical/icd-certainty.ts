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
 *   grounded `diagnoses` or history-subcategory fact substring-matches the
 *   normalized ICD description, OR a token from the ICD description
 *   substring-matches a grounded fact value. Symptoms, findings, chief
 *   complaint, and measurements are deliberately NOT used for grounding
 *   — if the only source is "patient has chest pain," we emit the
 *   underlying diagnosis (I21.2) but NOT the symptom code (R07.2).
 *
 * Stem matching:
 *   Tokens longer than 6 chars are truncated to a 6-char stem so
 *   Slavic inflection (hypertenzia/hypertenzie, hypertenze) matches the
 *   same stem (`hypert`). This is crude but works across sk/cs/en
 *   without per-locale wiring.
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
  }
  return false;
}

/**
 * Is this candidate ICD code grounded in a diagnosis or history fact?
 * Checks both directions so the filter is tolerant to whichever side
 * carries the more specific terminology.
 */
function isCandidateGrounded(
  candidate: CandidateIcdCode,
  facts: ExtractedFacts,
): boolean {
  const groundingFacts = [
    ...facts.diagnoses,
    ...facts.familyHistory,
    ...facts.personalHistory,
    ...facts.socialHistory,
    ...facts.workHistory,
    ...facts.substanceUse,
    ...facts.epidemiologicalHistory,
  ];
  if (groundingFacts.length === 0) return false;

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

  const hasDiagnosticFacts =
    facts.diagnoses.length > 0 ||
    facts.familyHistory.length > 0 ||
    facts.personalHistory.length > 0 ||
    facts.socialHistory.length > 0 ||
    facts.workHistory.length > 0 ||
    facts.substanceUse.length > 0 ||
    facts.epidemiologicalHistory.length > 0;

  for (const candidate of candidates) {
    if (!hasDiagnosticFacts) {
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
