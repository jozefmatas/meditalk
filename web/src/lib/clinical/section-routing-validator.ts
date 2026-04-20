/**
 * Post-processing Pass C — Section routing validator.
 *
 * Even though facts are deterministically assigned to template sections,
 * Opus still reads raw file content (doctor notes, uploaded documents) and
 * may inject medication lists into non-medication sections (e.g. OA) or
 * substance use details into non-Ab sections (e.g. SA).
 *
 * This pass runs after clearParentSections (Pass B) and deterministically
 * strips misrouted content blocks.
 *
 * Rules:
 *   1. Medication blocks (3+ consecutive lines with dosage patterns) are
 *      only allowed in medication sections (LA) and plan sections.
 *   2. Substance use content is only allowed in Ab (substance use) sections.
 *   3. Allergy content is only allowed in AA (allergy) sections.
 *   4. Cross-section duplicate lines: if the same non-trivial line appears
 *      in both OA and LA, strip from OA (keep in LA).
 *   5. Cross-section duplicate lines: EA↔AA (keep in AA, strip from EA).
 */

import { normalizeForMatch } from "./fact-validator";

// ---------------------------------------------------------------------------
// Section role detection — reuses CATEGORY_SECTION_PATTERNS
// ---------------------------------------------------------------------------

export type SectionRole =
  | "medications"
  | "substanceUse"
  | "allergies"
  | "epidemiological"
  | "plan"
  | "personalHistory"
  | "socialHistory"
  | "assessment"
  | "chiefComplaint"
  | "findings"
  | "other";

/**
 * Abbreviation → role map. Checked first for exact label match.
 * This avoids false positives from substring matching (e.g. "medic"
 * in "Past medical history" would incorrectly classify OA as medications).
 */
const ABBREVIATION_ROLE_MAP: Record<string, SectionRole> = {
  la: "medications",
  ab: "substanceUse",
  aa: "allergies",
  ea: "epidemiological",
  oa: "personalHistory",
  sa: "socialHistory",
  to: "chiefComplaint",
};

/**
 * Substring patterns for section role classification.
 * These are checked against BOTH the normalized label and context.
 * Patterns are more specific than CATEGORY_SECTION_PATTERNS to avoid
 * false positives (e.g. "medic" → "medical" in OA context).
 */
const ROLE_PATTERNS: [SectionRole, string[]][] = [
  [
    "medications",
    ["liek", "medication", "farmak", "liekov", "meds", "medikac"],
  ],
  ["substanceUse", ["abuz", "substance", "fajcen"]],
  ["allergies", ["alergick", "allerg", "alergi"]],
  ["epidemiological", ["epidemiolog", "epidemiol"]],
  [
    "plan",
    ["plan", "odporuc", "recommendation", "terapia", "therapy", "liecba"],
  ],
  ["personalHistory", ["osobn", "personal history", "past medical"]],
  ["socialHistory", ["socialn", "social history"]],
  [
    "assessment",
    ["zaver", "assessment", "conclusion", "diagnoz", "diagnostic impression"],
  ],
  [
    "chiefComplaint",
    ["terajsie", "present illness", "hpi", "chief complaint", "dovod"],
  ],
  [
    "findings",
    ["nalez", "finding", "objektivny", "status praesens", "physical exam", "vysetrenie"],
  ],
];

/**
 * Classify a section by its "role" based on its label and/or context.
 *
 * Priority 1: Exact abbreviation match on label (most reliable).
 * Priority 2: Substring match on label or context.
 */
export function classifySection(label: string, context?: string): SectionRole {
  const normalizedLabel = normalizeForMatch(label);

  // Priority 1: exact abbreviation match
  const abbrRole = ABBREVIATION_ROLE_MAP[normalizedLabel];
  if (abbrRole) return abbrRole;

  // Priority 2: substring match on label and context
  const normalizedContext = context ? normalizeForMatch(context) : "";

  for (const [role, patterns] of ROLE_PATTERNS) {
    for (const pattern of patterns) {
      if (
        normalizedLabel.includes(pattern) ||
        normalizedContext.includes(pattern)
      ) {
        return role;
      }
    }
  }

  return "other";
}

// ---------------------------------------------------------------------------
// Medication block detection
// ---------------------------------------------------------------------------

/**
 * Dosage pattern — number followed by pharmaceutical unit.
 * Reused from medication-normalizer.ts.
 */
const DOSE_REGEX =
  /\b\d+[,.]?\d*\s*(mg|ml|g|µg|mcg|ug|iu|u\.i\.|mikrogramov|mikrogramů)\b/i;

/** Frequency pattern — "1-0-1", "2x denne", etc. */
const FREQUENCY_REGEX =
  /\b(\d-\d-\d(?:-\d)?|\d+x\s*(?:denne|denn[eé]|daily))\b/i;

/** Route pattern — "p.o.", "i.v.", etc. */
const ROUTE_REGEX = /\b(p\.o\.|i\.v\.|s\.c\.|i\.m\.|per os)(?=\s|$)/i;

/** Medication block header keywords (normalized — no diacritics, lowercase). */
const MED_HEADER_KEYWORDS = [
  "medikacia",
  "medication",
  "medications",
  "chronic medication",
  "aktualna medikacia",
  "chronicka medikacia",
  "lieky",
  "farmakoterapia",
  "liekova anamneza",
];

/**
 * Check if a line looks like a medication entry (has dosage pattern).
 */
function isMedicationLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return (
    DOSE_REGEX.test(trimmed) ||
    FREQUENCY_REGEX.test(trimmed) ||
    ROUTE_REGEX.test(trimmed)
  );
}

/**
 * Check if a line is a medication block header.
 * Uses normalizeForMatch for consistent diacritics-insensitive comparison.
 */
function isMedBlockHeader(line: string): boolean {
  const normalized = normalizeForMatch(line);
  return MED_HEADER_KEYWORDS.some((kw) => normalized.includes(kw));
}

/**
 * Check if a line contains a narrative connector that contextualizes a med
 * reference within a clinical history (e.g. "v minulosti užíval Warfarin,
 * vysadený pre krvácanie"). These should NOT be stripped.
 */
function hasNarrativeContext(line: string): boolean {
  const normalized = normalizeForMatch(line);
  const connectors = [
    "v minulosti",
    "predtym",
    "vysadeny",
    "nasadeny",
    "zmeneny",
    "pre ",
    "kvoli",
    "od roku",
    "od r",
    "diagnostikovan",
    "lieceny",
    "liecen",
    "operovany",
    "stav po",
    "drive",
    "previously",
    "discontinued",
    "switched",
  ];
  return connectors.some((c) => normalized.includes(c));
}

/**
 * Detect and strip standalone medication list blocks from a section's text.
 *
 * A "medication block" is defined as:
 *   - An optional header line (e.g. "Chronická medikácia:")
 *   - Followed by 3+ consecutive lines with dosage patterns
 *
 * Lines with narrative context (e.g. "v minulosti užíval Warfarin") are
 * preserved even if they contain dosage patterns.
 *
 * Returns the text with medication blocks removed.
 */
function stripMedicationBlocks(text: string): string {
  const lines = text.split("\n");
  const toRemove = new Set<number>();

  let i = 0;
  while (i < lines.length) {
    // Check if this is a header line
    let blockStart = i;
    let hasHeader = false;

    if (isMedBlockHeader(lines[i])) {
      hasHeader = true;
      blockStart = i;
      i++;
    }

    // Count consecutive medication lines
    const medLineIndices: number[] = [];
    while (i < lines.length) {
      const trimmed = lines[i].trim();
      if (!trimmed) {
        // Empty line — check if the block continues after it
        i++;
        continue;
      }
      if (isMedicationLine(lines[i]) && !hasNarrativeContext(lines[i])) {
        medLineIndices.push(i);
        i++;
      } else {
        break;
      }
    }

    // If we found 3+ medication lines (or header + 2+), mark for removal
    const threshold = hasHeader ? 2 : 3;
    if (medLineIndices.length >= threshold) {
      if (hasHeader) toRemove.add(blockStart);
      for (const idx of medLineIndices) {
        toRemove.add(idx);
      }
      // Also remove empty lines between the header and first med line
      if (hasHeader) {
        for (let j = blockStart + 1; j < (medLineIndices[0] ?? i); j++) {
          if (!lines[j].trim()) toRemove.add(j);
        }
      }
    } else {
      // Not enough med lines to form a block, skip forward
      if (i === blockStart) i++;
    }
  }

  if (toRemove.size === 0) return text;

  const kept = lines.filter((_, idx) => !toRemove.has(idx));
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Substance use detection
// ---------------------------------------------------------------------------

/** Substance use keywords (normalized — no diacritics, lowercase). */
const SUBSTANCE_KEYWORDS = [
  "fajci",
  "fajc",
  "cigar",
  "tabak",
  "nikot",
  "alkohol",
  "pivo",
  "vino",
  "droga",
  "marihuana",
  "nefajci",
  "nefajc",
  "abstinen",
  "exfajciar",
  "kouri",
  "kour",
  "smok",
  "tobacco",
  "alcohol",
  "denne fajci",
  "denne fajc",
  "cigarety",
  "cigaretov",
];

/**
 * Check if a line is primarily about substance use.
 * Uses normalizeForMatch for consistent diacritics-insensitive comparison.
 */
function isSubstanceUseLine(line: string): boolean {
  const normalized = normalizeForMatch(line);
  if (!normalized) return false;
  return SUBSTANCE_KEYWORDS.some((kw) => normalized.includes(kw));
}

/**
 * Strip substance use content from a section's text.
 * Only removes lines where substance use is the primary topic.
 */
function stripSubstanceUseLines(text: string): string {
  const lines = text.split("\n");
  const kept = lines.filter((line) => !isSubstanceUseLine(line));
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Allergy content detection
// ---------------------------------------------------------------------------

/** Allergy keywords (normalized — no diacritics, lowercase). */
const ALLERGY_KEYWORDS = [
  "alergi",
  "allerg",
  "precitlivelos",
  "hypersensitiv",
  "intoleranci",
  "anafylax",
  "anaphylax",
  "bez znamych alergi",
  "neguje alergi",
  "no known allerg",
  "nkda",
];

/**
 * Check if a line is primarily about allergies.
 * Uses normalizeForMatch for consistent diacritics-insensitive comparison.
 */
function isAllergyLine(line: string): boolean {
  const normalized = normalizeForMatch(line);
  if (!normalized) return false;
  return ALLERGY_KEYWORDS.some((kw) => normalized.includes(kw));
}

/**
 * Strip allergy content from a section's text.
 * Only removes lines where allergy is the primary topic.
 */
function stripAllergyLines(text: string): string {
  const lines = text.split("\n");
  const kept = lines.filter((line) => !isAllergyLine(line));
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Cross-section dedup
// ---------------------------------------------------------------------------

/**
 * Deduplicate identical non-trivial lines between two sections.
 * When the same line appears in both, strip it from `textA` (keep in `textB`).
 * A line is "non-trivial" if it's longer than 20 characters.
 */
function deduplicateLines(textA: string, textB: string): string {
  if (!textA || !textB) return textA;

  const bLines = new Set(
    textB
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 20),
  );
  if (bLines.size === 0) return textA;

  const lines = textA.split("\n");
  const kept = lines.filter((line) => {
    const trimmed = line.trim();
    if (trimmed.length <= 20) return true; // keep short lines (headers, etc.)
    return !bLines.has(trimmed);
  });

  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Enforce section routing rules on generated content.
 *
 * This is a post-processing pass that catches content misrouted by the LLM.
 * It does NOT modify the original `sectionContents` — it returns a new copy.
 *
 * @param sectionContents - Map of section ID → generated text
 * @param sectionLabels - Map of section ID → label (e.g. "LA", "OA")
 * @param sectionContexts - Optional map of section ID → context description
 * @returns Updated section contents with misrouted content stripped
 */
export function enforceContentRouting(
  sectionContents: Record<string, string>,
  sectionLabels: Record<string, string>,
  sectionContexts?: Record<string, string>,
): Record<string, string> {
  const result = { ...sectionContents };

  // Build role map for all sections
  const roles = new Map<string, SectionRole>();
  for (const id of Object.keys(sectionLabels)) {
    roles.set(id, classifySection(sectionLabels[id], sectionContexts?.[id]));
  }

  // Find key section IDs
  const abSectionIds: string[] = [];
  const laSectionIds: string[] = [];
  const oaSectionIds: string[] = [];
  const saSectionIds: string[] = [];
  const aaSectionIds: string[] = [];
  const eaSectionIds: string[] = [];

  for (const [id, role] of roles) {
    if (role === "substanceUse") abSectionIds.push(id);
    if (role === "medications") laSectionIds.push(id);
    if (role === "personalHistory") oaSectionIds.push(id);
    if (role === "socialHistory") saSectionIds.push(id);
    if (role === "allergies") aaSectionIds.push(id);
    if (role === "epidemiological") eaSectionIds.push(id);
  }

  // Rule 1: Strip medication blocks from non-medication, non-plan sections
  for (const [id, role] of roles) {
    if (role !== "medications" && role !== "plan" && result[id]) {
      result[id] = stripMedicationBlocks(result[id]);
    }
  }

  // Rule 2: Strip substance use content from non-Ab sections
  for (const [id, role] of roles) {
    if (role !== "substanceUse" && result[id]) {
      result[id] = stripSubstanceUseLines(result[id]);
    }
  }

  // Rule 3: Strip allergy content from non-AA sections
  for (const [id, role] of roles) {
    if (role !== "allergies" && result[id]) {
      result[id] = stripAllergyLines(result[id]);
    }
  }

  // Rule 4: Cross-section dedup OA↔LA (keep in LA, strip from OA)
  for (const oaId of oaSectionIds) {
    for (const laId of laSectionIds) {
      if (result[oaId] && result[laId]) {
        result[oaId] = deduplicateLines(result[oaId], result[laId]);
      }
    }
  }

  // Rule 5: Cross-section dedup SA↔Ab (keep in Ab, strip from SA)
  for (const saId of saSectionIds) {
    for (const abId of abSectionIds) {
      if (result[saId] && result[abId]) {
        result[saId] = deduplicateLines(result[saId], result[abId]);
      }
    }
  }

  // Rule 6: Cross-section dedup EA↔AA (keep in AA, strip from EA)
  for (const eaId of eaSectionIds) {
    for (const aaId of aaSectionIds) {
      if (result[eaId] && result[aaId]) {
        result[eaId] = deduplicateLines(result[eaId], result[aaId]);
      }
    }
  }

  return result;
}
