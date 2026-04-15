/**
 * Pass 2 pre-processor — Deterministic fact-to-section assignment.
 *
 * Before facts reach Opus, this module assigns each fact to a concrete
 * template section ID. This removes one of the largest sources of
 * cross-run variance: Opus no longer decides where facts go.
 *
 * Matching strategy:
 *   1. Check `sectionContexts` for category keywords
 *   2. Check `sectionLabels` for abbreviation/name matches
 *   3. Unmatched facts go to `_unassigned`
 *
 * The matching is entirely deterministic: same inputs → same output.
 */
import type {
  ExtractedFact,
  ExtractedFacts,
  FactCategory,
} from "./fact-extraction";
import { FACT_CATEGORIES } from "./fact-extraction";
import { normalizeForMatch } from "./fact-validator";

/**
 * Keywords used to match a fact category to a section label or context.
 * Each category maps to an array of lowercase patterns — if any pattern
 * is found (substring match) in the normalized section label or context,
 * that section is the match.
 *
 * Order matters: first match wins when multiple sections could match.
 */
export const CATEGORY_SECTION_PATTERNS: Record<FactCategory, string[]> = {
  demographics: ["demograf", "demographic", "udaje o pacient", "patient data"],
  chiefComplaint: [
    "dovod",
    "reason",
    "chief complaint",
    "hlavna diagnoza",
    "dovod prijatia",
    "dovod vysetrenia",
  ],
  symptoms: ["symptom", "symptomy", "priznak", "potaze", "complaints"],
  findings: [
    "nalez",
    "finding",
    "vysetreni",
    "fyzikalny nalez",
    "objektivny nalez",
    "status praesens",
    "physical exam",
  ],
  measurements: [
    "meranie",
    "measurement",
    "vital",
    "laborator",
    "vysledk",
    "labs",
  ],
  diagnoses: [
    "diagnoz",
    "diagnos",
    "zaver",
    "assessment",
    "conclusion",
    "zakl",
  ],
  medications: [
    "liek",
    "medic",
    "farmak",
    "prescription",
    "liekov",
    "la",
    "meds",
  ],
  procedures: [
    "vykon",
    "procedur",
    "zakrok",
    "operac",
    "surgery",
    "intervention",
  ],
  familyHistory: ["rodinn", "family", "ra", "rodinnej"],
  personalHistory: ["osobn", "personal", "oa", "past medical"],
  socialHistory: ["socialn", "social", "sa", "byvanie", "rodinny stav"],
  workHistory: ["pracovn", "work", "occupat", "pa", "zamestnan"],
  substanceUse: [
    "abuz",
    "substance",
    "fajcen",
    "alkohol",
    "ab",
    "smoking",
    "drugs",
  ],
  epidemiologicalHistory: [
    "epidemiolog",
    "ea",
    "cestovan",
    "travel",
    "ockovanie",
    "vaccination",
  ],
  plan: ["plan", "odporuc", "recommendation", "terapia", "therapy", "liecba"],
};

/**
 * Short section abbreviations that are exact-match only (to avoid false
 * positives — "pa" matching inside "patient" etc.).
 */
const EXACT_MATCH_ABBREVIATIONS = new Set([
  "ra",
  "oa",
  "sa",
  "pa",
  "ea",
  "ab",
  "la",
  "aa",
  "to",
]);

/**
 * Assign each fact category to a template section ID.
 *
 * Returns a map of `{ sectionId: ExtractedFact[] }`. Facts whose category
 * doesn't match any section go under the `_unassigned` key.
 */
export function assignFactsToSections(
  facts: ExtractedFacts,
  sectionLabels: Record<string, string>,
  sectionContexts?: Record<string, string>,
): Record<string, ExtractedFact[]> {
  const result: Record<string, ExtractedFact[]> = {};

  // Build normalized lookup tables once
  const normalizedLabels: [string, string][] = Object.entries(
    sectionLabels,
  ).map(([id, label]) => [id, normalizeForMatch(label)]);
  const normalizedContexts: [string, string][] = sectionContexts
    ? Object.entries(sectionContexts).map(([id, ctx]) => [
        id,
        normalizeForMatch(ctx),
      ])
    : [];

  for (const category of FACT_CATEGORIES) {
    const categoryFacts = facts[category];
    if (categoryFacts.length === 0) continue;

    const sectionId = findSectionForCategory(
      category,
      normalizedLabels,
      normalizedContexts,
    );
    const key = sectionId ?? "_unassigned";
    if (!result[key]) result[key] = [];
    result[key].push(...categoryFacts);
  }

  return result;
}

/**
 * Find the best section ID for a given fact category.
 * Returns null if no match is found.
 */
function findSectionForCategory(
  category: FactCategory,
  normalizedLabels: [string, string][],
  normalizedContexts: [string, string][],
): string | null {
  const patterns = CATEGORY_SECTION_PATTERNS[category];
  if (!patterns || patterns.length === 0) return null;

  // Priority 1: Check section contexts (more descriptive, more reliable)
  for (const pattern of patterns) {
    if (EXACT_MATCH_ABBREVIATIONS.has(pattern)) continue; // Skip abbreviations for context matching
    for (const [id, ctx] of normalizedContexts) {
      if (ctx.includes(pattern)) return id;
    }
  }

  // Priority 2: Check section labels
  for (const pattern of patterns) {
    const isAbbreviation = EXACT_MATCH_ABBREVIATIONS.has(pattern);
    for (const [id, label] of normalizedLabels) {
      if (isAbbreviation) {
        // Exact match for short abbreviations to avoid "pa" matching "patient"
        if (label === pattern) return id;
      } else {
        if (label.includes(pattern)) return id;
      }
    }
  }

  return null;
}

/**
 * Category labels for the prompt output (without routing hints, since
 * routing is now deterministic).
 */
function categoryLabel(category: FactCategory): string {
  switch (category) {
    case "chiefComplaint":
      return "Chief Complaint";
    case "demographics":
      return "Demographics";
    case "symptoms":
      return "Symptoms";
    case "findings":
      return "Findings";
    case "measurements":
      return "Measurements";
    case "diagnoses":
      return "Diagnoses";
    case "medications":
      return "Medications";
    case "procedures":
      return "Procedures";
    case "familyHistory":
      return "Family History";
    case "personalHistory":
      return "Personal History";
    case "socialHistory":
      return "Social History";
    case "workHistory":
      return "Work History";
    case "substanceUse":
      return "Substance Use";
    case "epidemiologicalHistory":
      return "Epidemiological History";
    case "plan":
      return "Plan";
  }
}

/**
 * Format assigned facts for the Opus prompt. Groups facts by section,
 * producing a deterministic block that tells Opus exactly what goes where.
 */
export function formatAssignedFactsForPrompt(
  assignment: Record<string, ExtractedFact[]>,
  sectionLabels: Record<string, string>,
): string {
  const lines: string[] = [];

  // First render facts assigned to specific sections (in section label order)
  const sectionIds = Object.keys(sectionLabels);
  for (const id of sectionIds) {
    const facts = assignment[id];
    if (!facts || facts.length === 0) continue;
    const label = sectionLabels[id];
    lines.push(`[Section "${label}" (${id})]:`);
    for (const f of facts) {
      lines.push(`  - [${categoryLabel(f.category)}] ${f.value}`);
    }
  }

  // Then render unassigned facts as general context
  const unassigned = assignment["_unassigned"];
  if (unassigned && unassigned.length > 0) {
    lines.push("[General context — place in the most appropriate section]:");
    for (const f of unassigned) {
      lines.push(`  - [${categoryLabel(f.category)}] ${f.value}`);
    }
  }

  return lines.join("\n");
}
