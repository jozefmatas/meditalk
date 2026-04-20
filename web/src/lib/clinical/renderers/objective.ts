/**
 * Deterministic Objective-section renderers.
 *
 * Consume the `EncounterModel.objective` slot. Each renderer targets a
 * specific kind of objective content — vitals, labs, EKG, imaging, or
 * exam prose. No LLM, no post-processing, no per-line guards. Purity
 * is structural: the model has already partitioned facts into the
 * correct slot before we get here, so there's nothing to filter.
 *
 * A single top-level `renderObjectiveSection(model, {role, label})`
 * dispatches to the correct sub-renderer based on the section role.
 */

import type { EncounterModel, FactRef } from "../encounter-model";
import type { SectionRole } from "../section-routing-validator";
import { parseMeasurement, type MeasurementKind } from "../numeric-sanity";

// ---------------------------------------------------------------------------
// Vital-kind detection (delegates to the Numeric Sanity parser)
// ---------------------------------------------------------------------------

/** Vital kinds we expose as "bucketable" for kind-specific subsections. */
const VITAL_KINDS_LIST: readonly MeasurementKind[] = [
  "bp",
  "hr",
  "rr",
  "spo2",
  "temp_c",
  "gcs",
];

/**
 * Map an explicit subsection label ("Krvný tlak", "Pulz", "Saturácia")
 * to a specific `MeasurementKind`. Returns `null` when the label is
 * generic ("Vitálne funkcie", "Vital signs") — the caller renders ALL
 * vital kinds for those.
 */
function detectVitalKindFromLabel(label: string): MeasurementKind | null {
  const normalized = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/krvny tlak|blood pressure|\btk\b|\bbp\b/.test(normalized)) return "bp";
  if (/srdcov|pulse|\btep\b|\bsf\b|\bhr\b|pulz/.test(normalized)) return "hr";
  if (/dychov|respirator|\bdf\b|\brr\b/.test(normalized)) return "rr";
  if (/saturac|spo\s*2|o2\s*sat/.test(normalized)) return "spo2";
  if (/teplot|temperature|\btt\b/.test(normalized)) return "temp_c";
  if (/\bgcs\b/.test(normalized)) return "gcs";
  return null;
}

function factMeasurementKind(f: FactRef): MeasurementKind | null {
  const parsed = parseMeasurement(f.value);
  return parsed?.kind ?? null;
}

// ---------------------------------------------------------------------------
// Renderers — one per subsection kind
// ---------------------------------------------------------------------------

/**
 * Render a vitals subsection. When `kindHint` is set, emit only facts
 * of that measurement kind. When null (generic "Vitálne funkcie"),
 * emit every vital fact in order.
 *
 * Always one fact per line, preserving the fact value verbatim (units
 * and timestamps included).
 */
export function renderVitalsSection(
  model: EncounterModel,
  label: string,
): string {
  const all = model.objective.vitals;
  if (all.length === 0) return "";
  const kindHint = detectVitalKindFromLabel(label);

  // Auto-fallback: if the label suggests a specific kind but this is the
  // ONLY vitals-role subsection (no sibling for other kinds), render all
  // vital kinds. The caller is expected to pass the label; sibling
  // detection happens one level up in the section planner.
  const targetKinds = kindHint ? [kindHint] : VITAL_KINDS_LIST;
  const targets = new Set<MeasurementKind>(targetKinds);
  const matching = all.filter((f) => {
    const k = factMeasurementKind(f);
    return k !== null && targets.has(k);
  });
  if (matching.length === 0) return "";
  return matching.map((f) => f.value).join("\n");
}

/** Render a labs subsection — consumes `model.objective.labs` verbatim. */
export function renderLabsSection(model: EncounterModel): string {
  const all = model.objective.labs;
  if (all.length === 0) return "";
  return all.map((f) => f.value).join("\n");
}

/** Render an EKG subsection — consumes `model.objective.studies.ecg`. */
export function renderEkgSection(model: EncounterModel): string {
  const all = model.objective.studies.ecg;
  if (all.length === 0) return "";
  return all.map((f) => f.value).join("\n");
}

/** Render an imaging subsection — consumes `model.objective.studies.imaging`. */
export function renderImagingSection(model: EncounterModel): string {
  const all = model.objective.studies.imaging;
  if (all.length === 0) return "";
  return all.map((f) => f.value).join("\n");
}

/**
 * Render a generic exam-findings subsection as compact prose — sentence-
 * joined facts separated by ", " for inline readability. Used for
 * "Celkové vyšetrenie" / "Status praesens" / etc.
 */
export function renderExamSection(model: EncounterModel): string {
  const all = model.objective.examFindings;
  if (all.length === 0) return "";
  return all.map((f) => f.value).join(", ");
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Single entry point for any objective-role section. The caller passes
 * the section's classified role + its label; we return the rendered
 * text (or `""` when the model has no content for that slot).
 */
export function renderObjectiveSection(
  model: EncounterModel,
  role: SectionRole,
  label: string,
): string | null {
  switch (role) {
    case "vitals":
      return renderVitalsSection(model, label);
    case "labs":
      return renderLabsSection(model);
    case "ekg":
      return renderEkgSection(model);
    default:
      return null;
  }
}
