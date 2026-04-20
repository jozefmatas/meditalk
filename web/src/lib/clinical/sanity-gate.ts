/**
 * Clinical sanity gate — final pass before a generated note is returned to
 * the user. Wraps the existing `enforceContentRouting` strips and adds:
 *
 *   1. PHI-only line stripping — lines consisting entirely of PHI tokens
 *      like "[ADDRESS] (14:02)" are removed (the fact extractor sometimes
 *      picks up location data as a "measurement", which the PHI scrubber
 *      correctly redacts but leaves as a dangling bullet).
 *   2. Empty-critical-section detection — if diagnoses exist as validated
 *      facts but the Assessment section renders empty, the gate attempts
 *      a deterministic re-render from the pre-built ICD block before
 *      surfacing the problem to the doctor.
 *   3. Measurement safety net — impossible vitals that somehow survived
 *      upstream validation (e.g. the doctor typed them into the note
 *      template rather than into a fact field) are auto-stripped.
 *   4. A structured `SanityReport` is returned so the caller can surface
 *      warnings in the UI and block publish on critical errors.
 *
 * **Gate-not-flag semantics**: critical errors trigger deterministic
 * auto-fixers ("rerender_assessment_from_icd", "strip_impossible_measurement")
 * that resolve the issue where possible. When a fix applies, the error is
 * downgraded to `info` with an `auto_rerendered: true` marker on the
 * intervention. When no fix is available the error persists and the caller
 * can either block publish or surface a doctor warning. The caller never
 * ships a silently-broken note.
 */

import type { ExtractedFact } from "./fact-extraction";
import {
  classifySection,
  enforceContentRouting,
  type SectionRole,
} from "./section-routing-validator";
import { validateMeasurementValue } from "./numeric-sanity";
import { renderAssessment } from "./section-renderer";

/** Severity a sanity issue carries. */
export type SanitySeverity = "error" | "warning" | "info";

/** One sanity issue attached to a specific section (or the whole note). */
export interface SanityIssue {
  /** Machine code so the UI / callers can branch on it. */
  code:
    | "phi_only_line_stripped"
    | "misrouted_content_stripped"
    | "empty_assessment_with_diagnoses"
    | "impossible_measurement_in_output"
    | "duplicate_conflicting_diagnoses";
  severity: SanitySeverity;
  /** Section affected (null = global). */
  sectionId: string | null;
  message: string;
  /** Optional details useful for debugging / telemetry. */
  detail?: string;
}

/** Single deterministic fix the gate applied. */
export interface SanityIntervention {
  code:
    | "strip_phi_only_line"
    | "strip_misrouted_content"
    | "rerender_assessment_from_icd"
    | "strip_impossible_measurement";
  sectionId: string;
  /** What got removed / replaced / rerendered, truncated for log-friendliness. */
  snippet: string;
  /**
   * When true, this intervention was triggered by a critical error
   * (auto-rerender path). Callers should surface these in observability
   * even though the error itself was downgraded to info.
   */
  autoRerendered?: boolean;
}

/** Structured report returned alongside the final contents. */
export interface SanityReport {
  /** Critical issues — caller should surface to the doctor. */
  errors: SanityIssue[];
  /** Non-blocking issues — worth surfacing but don't halt publish. */
  warnings: SanityIssue[];
  /** Informational notes (e.g. successful fixes). */
  info: SanityIssue[];
  /** Deterministic repairs the gate applied. */
  interventions: SanityIntervention[];
}

/** Output of the gate — fixed contents + the structured report. */
export interface SanityGateResult {
  contents: Record<string, string>;
  report: SanityReport;
}

// ---------------------------------------------------------------------------
// 1. PHI-only line stripping
// ---------------------------------------------------------------------------

/**
 * Match a line that is entirely PHI tokens (optionally with surrounding
 * whitespace, timestamps, punctuation). A line qualifies when, once all
 * PHI tokens + ignorable characters are stripped, nothing clinically
 * meaningful remains.
 *
 * Examples that strip:
 *   "[ADDRESS] (14:02)"
 *   "[PATIENT_NAME]"
 *   "  - [PHONE] "
 *
 * Examples that DO NOT strip (they carry clinical info alongside PHI):
 *   "Pacient [PATIENT_NAME], GCS 15"
 *   "Kontaktná osoba: [PHONE] (príbuzný)"
 */
const PHI_TOKEN_REGEX =
  /\[(?:ADDRESS|PATIENT_NAME|PHONE|EMAIL|BIRTH_NUMBER|PATIENT_ID|NUMERIC_ID)\]/g;

/**
 * Strip lines from `text` that consist entirely of PHI tokens (plus
 * ignorable chrome like bullets, timestamps, punctuation).
 *
 * Returns the new text and the list of stripped snippets so the caller
 * can record them on the sanity report.
 */
export function stripPhiOnlyLines(text: string): {
  text: string;
  stripped: string[];
} {
  if (!text) return { text, stripped: [] };
  const lines = text.split("\n");
  const kept: string[] = [];
  const stripped: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      kept.push(line);
      continue;
    }

    // Replace PHI tokens with empty string and strip all ignorable chars
    // (timestamps like (14:02), bullets "-" "•", punctuation, whitespace).
    // What remains MUST be empty for the line to qualify as PHI-only.
    const stripPhi = trimmed.replace(PHI_TOKEN_REGEX, "");
    const ignorable =
      /\s+|\(\s*\d{1,2}[:.]\d{2}(?::\d{2})?\s*\)|[-•\u2022\u2013\u2014*·]|[,;:.]/g;
    const remainder = stripPhi.replace(ignorable, "");

    // If nothing clinically meaningful remains AND the line actually
    // contained at least one PHI token, the line is PHI-only → strip.
    if (remainder.length === 0 && PHI_TOKEN_REGEX.test(trimmed)) {
      stripped.push(trimmed);
      // Reset the regex's lastIndex because test() on a /g regex mutates it.
      PHI_TOKEN_REGEX.lastIndex = 0;
      continue;
    }
    PHI_TOKEN_REGEX.lastIndex = 0;
    kept.push(line);
  }

  return {
    text: kept
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    stripped,
  };
}

// ---------------------------------------------------------------------------
// 2. Empty critical section detector
// ---------------------------------------------------------------------------

/**
 * Detect sections whose content is effectively empty (only whitespace /
 * placeholder characters). "Effectively empty" is stricter than
 * `text.trim() === ""` — a section containing only "—" or "N/A" is also
 * empty for gating purposes.
 */
function isSectionEffectivelyEmpty(text: string | undefined): boolean {
  if (!text) return true;
  const placeholder = text
    .replace(/[\s\u2013\u2014\-—–—]+/g, "")
    .replace(/^(N\/A|NA|nil|none)$/gi, "")
    .trim();
  return placeholder.length === 0;
}

// ---------------------------------------------------------------------------
// 3. Impossible measurement safety net
// ---------------------------------------------------------------------------

/**
 * Scan rendered text for lines that look like measurements but report
 * impossible values (BP 800/100, SpO₂ 120%, HR 350). This is a safety
 * net — the upstream fact validator already drops these — but a doctor
 * may have typed a vital directly into a non-fact template field, or
 * an impossible value may have slipped through via the narrative pass.
 *
 * Returns the list of offending lines per section.
 */
function findImpossibleMeasurementLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split("\n");
  const offenders: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const verdict = validateMeasurementValue(trimmed);
    if (!verdict.ok && verdict.severity === "impossible") {
      offenders.push(trimmed);
    }
  }
  return offenders;
}

// ---------------------------------------------------------------------------
// 4. Main entry point
// ---------------------------------------------------------------------------

export interface SanityGateInput {
  /** Initial rendered section contents (keyed by section ID). */
  sectionContents: Record<string, string>;
  /** Section label per ID — used for role classification. */
  sectionLabels: Record<string, string>;
  /** Optional per-section context text (helps classify role). */
  sectionContexts?: Record<string, string>;
  /** Validated facts from Pass 1.5 — drives expectation checks. */
  validatedFacts?: {
    diagnoses: ExtractedFact[];
    medications: ExtractedFact[];
  };
  /**
   * Pre-rendered ICD block (one ICD line per row). When the gate detects
   * an empty Assessment with validated diagnoses and an ICD block is
   * available, it auto-rerenders the Assessment deterministically from
   * this block instead of surfacing the error to the caller.
   */
  icdBlock?: string;
  /**
   * When `true`, also run `enforceContentRouting` as part of the gate.
   * Callers that have already applied Pass C upstream can pass `false`
   * to avoid double-stripping — the gate will still report on what
   * remains, it just won't re-strip.
   */
  runContentRouting?: boolean;
}

/**
 * Run all sanity checks, apply deterministic fixes, and return the final
 * contents along with a structured report. Never throws — callers can
 * always ship `result.contents`; the report is for observability and
 * UI surface.
 */
export function runSanityGate(input: SanityGateInput): SanityGateResult {
  const {
    sectionContents,
    sectionLabels,
    sectionContexts,
    validatedFacts,
    icdBlock,
    runContentRouting = true,
  } = input;

  const errors: SanityIssue[] = [];
  const warnings: SanityIssue[] = [];
  const info: SanityIssue[] = [];
  const interventions: SanityIntervention[] = [];

  // 4a. Apply content routing (Pass C) with before/after diffing so we can
  //     report what was stripped rather than silently dropping it.
  let working: Record<string, string> = { ...sectionContents };
  if (runContentRouting) {
    const before = { ...working };
    const after = enforceContentRouting(before, sectionLabels, sectionContexts);
    for (const id of Object.keys(sectionLabels)) {
      const prev = before[id] ?? "";
      const next = after[id] ?? "";
      if (prev !== next) {
        interventions.push({
          code: "strip_misrouted_content",
          sectionId: id,
          snippet: truncate(diffSummary(prev, next), 160),
        });
        warnings.push({
          code: "misrouted_content_stripped",
          severity: "warning",
          sectionId: id,
          message: `Misrouted content was stripped from section "${sectionLabels[id] ?? id}".`,
          detail: truncate(diffSummary(prev, next), 200),
        });
      }
    }
    working = after;
  }

  // 4b. PHI-only line stripping — per section.
  for (const id of Object.keys(working)) {
    const text = working[id];
    if (!text) continue;
    const { text: cleaned, stripped } = stripPhiOnlyLines(text);
    if (stripped.length > 0) {
      working[id] = cleaned;
      for (const snippet of stripped) {
        interventions.push({
          code: "strip_phi_only_line",
          sectionId: id,
          snippet: truncate(snippet, 160),
        });
      }
      info.push({
        code: "phi_only_line_stripped",
        severity: "info",
        sectionId: id,
        message: `Removed ${stripped.length} PHI-only line(s) from "${sectionLabels[id] ?? id}".`,
        detail: stripped.map((s) => truncate(s, 60)).join(" | "),
      });
    }
  }

  // 4c. Empty-critical-section detection + auto-rerender.
  //     When diagnosis facts exist and the Assessment is empty, try to
  //     recover deterministically from the pre-rendered ICD block.
  //     If the rerender produces content, downgrade the error to info
  //     and record the intervention. If no ICD block is available or it
  //     produces empty output, keep the error so the caller can surface
  //     it to the doctor.
  const diagnoses = validatedFacts?.diagnoses ?? [];
  if (diagnoses.length > 0) {
    const assessmentIds = findRoleIds(
      sectionLabels,
      sectionContexts,
      "assessment",
    );
    for (const id of assessmentIds) {
      if (!isSectionEffectivelyEmpty(working[id])) continue;

      const rerendered = icdBlock ? renderAssessment(icdBlock) : "";
      if (rerendered.trim().length > 0) {
        working[id] = rerendered;
        interventions.push({
          code: "rerender_assessment_from_icd",
          sectionId: id,
          snippet: truncate(rerendered.split("\n")[0] ?? "", 160),
          autoRerendered: true,
        });
        info.push({
          code: "empty_assessment_with_diagnoses",
          severity: "info",
          sectionId: id,
          message: `Section "${sectionLabels[id] ?? id}" was empty; auto-rerendered from the pre-built ICD block.`,
          detail: diagnoses
            .slice(0, 5)
            .map((d) => d.value)
            .join(" | "),
        });
      } else {
        errors.push({
          code: "empty_assessment_with_diagnoses",
          severity: "error",
          sectionId: id,
          message: `Section "${sectionLabels[id] ?? id}" is empty but ${diagnoses.length} diagnosis fact(s) were validated, and no ICD block is available for auto-rerender.`,
          detail: diagnoses
            .slice(0, 5)
            .map((d) => d.value)
            .join(" | "),
        });
      }
    }
  }

  // 4d. Impossible measurement safety net + auto-strip.
  //     Strip offending lines from the rendered text (this is the safe
  //     auto-fix — an impossible value left in the note is a direct
  //     patient-safety risk). Record each strip as an intervention plus
  //     a warning so the doctor can verify what was missed upstream.
  for (const id of Object.keys(working)) {
    const text = working[id] ?? "";
    const offenders = findImpossibleMeasurementLines(text);
    if (offenders.length === 0) continue;

    const offenderSet = new Set(offenders.map((o) => o.trim()));
    const filtered = text
      .split("\n")
      .filter((line) => !offenderSet.has(line.trim()))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    working[id] = filtered;

    for (const line of offenders) {
      interventions.push({
        code: "strip_impossible_measurement",
        sectionId: id,
        snippet: truncate(line, 160),
        autoRerendered: true,
      });
      warnings.push({
        code: "impossible_measurement_in_output",
        severity: "warning",
        sectionId: id,
        message: `Section "${sectionLabels[id] ?? id}" contained an implausible measurement; it was auto-stripped.`,
        detail: truncate(line, 160),
      });
    }
  }

  return {
    contents: working,
    report: { errors, warnings, info, interventions },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

/**
 * Produce a compact diff summary describing what was removed going from
 * `prev` → `next`. Lives here (rather than a generic util) because the
 * diff shape is specific to sanity-report surfacing.
 */
function diffSummary(prev: string, next: string): string {
  const prevLines = prev.split("\n");
  const nextSet = new Set(next.split("\n").map((l) => l.trim()));
  const removed = prevLines
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !nextSet.has(l));
  return removed.slice(0, 3).join(" ⋯ ") + (removed.length > 3 ? " …" : "");
}

/**
 * Find section IDs that classify as a given role. Mirrors the role
 * classification used by `enforceContentRouting` so the gate's empty-
 * section check applies to the same section set as the strip rules.
 */
function findRoleIds(
  sectionLabels: Record<string, string>,
  sectionContexts: Record<string, string> | undefined,
  target: SectionRole,
): string[] {
  const out: string[] = [];
  for (const id of Object.keys(sectionLabels)) {
    if (classifySection(sectionLabels[id], sectionContexts?.[id]) === target) {
      out.push(id);
    }
  }
  return out;
}
