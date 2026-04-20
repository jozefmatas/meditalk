/**
 * Assessment relevance classifier for ICD candidates.
 *
 * Classifies ICD candidates into three tiers based on which fact
 * categories ground them, then applies caps to keep the Záver/Assessment
 * section focused on the current encounter.
 *
 * Tiers:
 * - active_current: grounded by diagnoses, chiefComplaint, symptoms, or findings
 * - chronic_relevant: grounded only by personalHistory or medications
 * - background_only: everything else (excluded from output)
 */

import type { CandidateIcdCode } from "./types";
import type { ExtractedFacts } from "./fact-extraction";
import { normalizeForMatch } from "./fact-validator";
import { extractContentTokens } from "./icd-certainty";
import type { FactCategory } from "./fact-extraction";

/** Active categories — these signal current-encounter relevance. */
const ACTIVE_CATEGORIES: ReadonlySet<FactCategory> = new Set([
  "diagnoses",
  "chiefComplaint",
  "symptoms",
  "findings",
]);

/** Chronic categories — these signal management-relevant history. */
const CHRONIC_CATEGORIES: ReadonlySet<FactCategory> = new Set([
  "personalHistory",
  "medications",
]);

export interface ClassifiedCandidate extends CandidateIcdCode {
  tier: "active_current" | "chronic_relevant" | "background_only";
  /** Number of grounding facts that link to this candidate. */
  groundingCount: number;
}

export interface ClassificationResult {
  activeCurrent: CandidateIcdCode[];
  chronicRelevant: CandidateIcdCode[];
  backgroundOnly: CandidateIcdCode[];
  counts: {
    total: number;
    active: number;
    chronic: number;
    background: number;
  };
}

/** Maximum active_current candidates in output. */
const MAX_ACTIVE = 4;
/** Maximum chronic_relevant candidates in output. */
const MAX_CHRONIC = 5;

/**
 * Check if a candidate ICD code is grounded in any facts of the given categories.
 * Returns the count of matching facts.
 */
function countGroundingFacts(
  candidate: CandidateIcdCode,
  facts: ExtractedFacts,
  categories: ReadonlySet<FactCategory>,
): number {
  const descNorm = normalizeForMatch(candidate.description);
  const descTokens = extractContentTokens(candidate.description);
  const codeNorm = candidate.code.toUpperCase();
  let count = 0;

  for (const category of categories) {
    const categoryFacts = facts[category];
    if (!Array.isArray(categoryFacts)) continue;
    for (const fact of categoryFacts) {
      const factNorm = normalizeForMatch(fact.value);

      // Literal ICD code in fact value
      if (factNorm.includes(codeNorm.toLowerCase())) {
        count++;
        continue;
      }

      // Token overlap: any desc token found in fact value or vice versa
      const factTokens = extractContentTokens(fact.value);
      const hasOverlap =
        descTokens.some((t) => t.length >= 3 && factNorm.includes(t)) ||
        factTokens.some((t) => t.length >= 3 && descNorm.includes(t));
      if (hasOverlap) {
        count++;
      }
    }
  }

  return count;
}

/**
 * Classify ICD candidates into tiers based on fact grounding, then
 * apply caps to keep the assessment focused.
 */
export function classifyAssessment(
  candidates: CandidateIcdCode[],
  facts: ExtractedFacts,
): ClassificationResult {
  const classified: ClassifiedCandidate[] = candidates.map((c) => {
    const activeCount = countGroundingFacts(c, facts, ACTIVE_CATEGORIES);
    if (activeCount > 0) {
      return {
        ...c,
        tier: "active_current" as const,
        groundingCount: activeCount,
      };
    }

    const chronicCount = countGroundingFacts(c, facts, CHRONIC_CATEGORIES);
    if (chronicCount > 0) {
      return {
        ...c,
        tier: "chronic_relevant" as const,
        groundingCount: chronicCount,
      };
    }

    return { ...c, tier: "background_only" as const, groundingCount: 0 };
  });

  // Sort each tier by grounding count (descending)
  const active = classified
    .filter((c) => c.tier === "active_current")
    .sort((a, b) => b.groundingCount - a.groundingCount);
  const chronic = classified
    .filter((c) => c.tier === "chronic_relevant")
    .sort((a, b) => b.groundingCount - a.groundingCount);
  const background = classified.filter((c) => c.tier === "background_only");

  // Apply caps — overflow from active goes to chronic
  const keptActive = active.slice(0, MAX_ACTIVE);
  const overflowActive = active.slice(MAX_ACTIVE);

  // Merge overflow into chronic, re-sort
  const mergedChronic = [...overflowActive, ...chronic].sort(
    (a, b) => b.groundingCount - a.groundingCount,
  );
  const keptChronic = mergedChronic.slice(0, MAX_CHRONIC);

  return {
    activeCurrent: keptActive,
    chronicRelevant: keptChronic,
    backgroundOnly: background,
    counts: {
      total: candidates.length,
      active: keptActive.length,
      chronic: keptChronic.length,
      background: background.length,
    },
  };
}
