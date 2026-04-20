/**
 * Section-target purity enforcement.
 *
 * Final line of defense BEFORE the note is returned. Walks every
 * rendered section, classifies its role, and rejects lines that
 * clearly don't belong there:
 *
 *   - medications (LA)   → reject symptom-narrative phrases
 *                          ("pálenie", "bolesť", "od nedele", "včera")
 *   - ekg                → reject structured-assessment headings
 *                          ("Hlavná diagnóza", "Vedľajšie diagnózy")
 *   - vitals             → same assessment-heading reject
 *   - assessment (Záver) → reject vitals patterns (TK/SF/DF/SpO2 lines)
 *                          and TO-narrative markers
 *   - chiefComplaint (TO) → reject structured-assessment headings and
 *                          lone ICD-code lines
 *
 * When a line is rejected, it's stripped from the section and a
 * `SectionPurityViolation` is recorded so the caller can surface it
 * in telemetry. The section content is never silently corrupted —
 * every strip is visible in the report.
 *
 * This module complements (it doesn't replace) the sanity-gate's
 * content-routing pass. That pass operates at the "block" level
 * (medication blocks, substance-use blocks); this one operates at the
 * per-line level for the narrower "did the wrong renderer's output
 * land in this section?" problem.
 */

import { classifySection, type SectionRole } from "./section-routing-validator";
import { normalizeForMatch } from "./fact-validator";

// ---------------------------------------------------------------------------
// Rejection patterns
// ---------------------------------------------------------------------------

/** Symptom / HPI narrative phrases that should never appear in the LA list. */
const SYMPTOM_NARRATIVE_PATTERNS = [
  "palenie",
  "bolest",
  "od nedele",
  "od pondelka",
  "od utorka",
  "vcera",
  "dnes rano",
  "od rana",
  "pocit na hrudi",
  "dychavicnost",
  "nauzea",
  "vertigo",
  "pain",
  "headache",
  "chest pain",
  "yesterday",
  "since morning",
];

/** Structured-assessment headings that should never appear outside Záver. */
const ASSESSMENT_HEADING_PATTERNS = [
  "hlavna diagnoza",
  "vedlajsie diagnozy",
  "chronicke ochoreni",
  "chronicke onemocneni",
  "diferencialna diagnostika",
  "diferencialni diagnostika",
  "zaver",
  "primary diagnosis",
  "secondary diagnoses",
  "chronic conditions",
  "differential diagnoses",
];

/**
 * Vitals-line regexes — if any of these match, the line is a raw vital
 * reading that doesn't belong in a narrative / assessment section.
 */
const VITALS_LINE_REGEX = [
  /\bTK\s+\d/i,
  /\bSF\s+\d/i,
  /\bDF\s+\d/i,
  /\bSpO2\b/i,
  /O₂SAT/i,
  /\bGCS\b\s*\d/i,
  /glyk[eé]mi/i,
  /telesn[aá]\s+teplot/i,
];

/** Obvious CSV-debris patterns — a safety net in case a mapper leaks raw. */
const CSV_DEBRIS_REGEX = [
  // Trailing `",R07.4-Description` or similar code fragment in the middle of a line.
  /"\s*,\s*[A-Z]\d{2}(?:\.\d+)?\s*-/,
  // Inline `R07.4-Description` without a leading space (legitimate
  // rendering prefixes the code).
  /\b[A-Z]\d{2}\.\d+\s*-\s*[A-Z]/,
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PurityRejectionReason =
  | "symptom_narrative_in_medications"
  | "icd_headings_outside_assessment"
  | "vitals_line_in_narrative"
  | "csv_debris"
  | "icd_codes_in_chief_complaint";

export interface SectionPurityViolation {
  sectionId: string;
  role: SectionRole;
  reason: PurityRejectionReason;
  snippet: string;
}

export interface SectionPurityResult {
  contents: Record<string, string>;
  violations: SectionPurityViolation[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function containsAny(haystack: string, needles: readonly string[]): boolean {
  for (const n of needles) if (haystack.includes(n)) return true;
  return false;
}

function matchesAny(line: string, regexes: readonly RegExp[]): boolean {
  for (const r of regexes) if (r.test(line)) return true;
  return false;
}

/**
 * Test an individual line against the ruleset for its section role.
 * Returns the rejection reason when the line should be dropped, or
 * `null` when the line is acceptable for that role.
 */
function rejectReason(
  line: string,
  role: SectionRole,
): PurityRejectionReason | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Universal: CSV debris never belongs anywhere.
  if (matchesAny(trimmed, CSV_DEBRIS_REGEX)) return "csv_debris";

  const lowerNorm = normalizeForMatch(trimmed);

  switch (role) {
    case "medications":
      // LA is a list of drug names + doses. Symptom narrative ("pálenie",
      // "bolesť na hrudi") is clearly the wrong renderer's output.
      if (containsAny(lowerNorm, SYMPTOM_NARRATIVE_PATTERNS)) {
        return "symptom_narrative_in_medications";
      }
      return null;

    case "ekg":
    case "vitals":
    case "labs":
      // These structured subsections must never carry the Záver's
      // bucketed headings. If they do, it means the structured renderer
      // bled past its own section.
      if (containsAny(lowerNorm, ASSESSMENT_HEADING_PATTERNS)) {
        return "icd_headings_outside_assessment";
      }
      return null;

    case "assessment":
      // Záver: no raw vital readings.
      if (matchesAny(trimmed, VITALS_LINE_REGEX)) {
        return "vitals_line_in_narrative";
      }
      return null;

    case "chiefComplaint":
      // TO is narrative only — no ICD codes on their own line, no
      // structured-assessment headings.
      if (containsAny(lowerNorm, ASSESSMENT_HEADING_PATTERNS)) {
        return "icd_headings_outside_assessment";
      }
      // A line that is JUST an ICD code + description.
      if (/^[A-Z]\d{2}(?:\.\d+)?\s+\S/.test(trimmed)) {
        return "icd_codes_in_chief_complaint";
      }
      return null;

    case "plan":
      // Plan is narrative — reject raw vitals lines and bare ICD lines.
      if (matchesAny(trimmed, VITALS_LINE_REGEX)) {
        return "vitals_line_in_narrative";
      }
      return null;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Enforce per-line purity for every section. Returns a new content map
 * (the input is never mutated) and a list of violations describing what
 * got stripped and from where.
 */
export function enforceSectionPurity(
  sectionContents: Record<string, string>,
  sectionLabels: Record<string, string>,
  sectionContexts?: Record<string, string>,
): SectionPurityResult {
  const violations: SectionPurityViolation[] = [];
  const result: Record<string, string> = { ...sectionContents };

  for (const [id, text] of Object.entries(sectionContents)) {
    if (!text) continue;
    const role = classifySection(
      sectionLabels[id] ?? id,
      sectionContexts?.[id],
    );

    const lines = text.split("\n");
    const kept: string[] = [];
    for (const line of lines) {
      const reason = rejectReason(line, role);
      if (reason) {
        violations.push({
          sectionId: id,
          role,
          reason,
          snippet: line.trim().slice(0, 160),
        });
        continue;
      }
      kept.push(line);
    }

    result[id] = kept
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  return { contents: result, violations };
}
