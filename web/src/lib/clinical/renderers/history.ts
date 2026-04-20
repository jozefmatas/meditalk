/**
 * Deterministic history / list-style section renderers.
 *
 * Reads from `EncounterModel.history.*`. Each slot (medications,
 * allergies, habits, family, personal, social, work, epidemiological)
 * renders as compact inline prose — commas between items, period at
 * the end. No LLM.
 *
 * The section planner (section-renderer dispatch) decides which slot
 * maps to which template section; these functions just format.
 */

import type { EncounterModel, FactRef } from "../encounter-model";

/** Render a list of fact refs as "A, B, C." with period. */
function renderList(refs: FactRef[]): string {
  if (refs.length === 0) return "";
  // Preserve fact value verbatim; negated facts carry a compact prefix
  // so the doctor immediately sees what is absent. Full per-locale
  // negation rendering moves to the specialty pack in Phase 5.
  const parts = refs.map((r) => (r.negated ? `neguje ${r.value}` : r.value));
  return parts.join(", ") + (parts.some(Boolean) ? "." : "");
}

export function renderMedicationsSection(model: EncounterModel): string {
  const meds = model.history.medications;
  if (meds.length === 0) return "";
  // Medications use newlines between entries — this matches how doctors
  // format LA in the reference note (one med per line with dose+freq).
  return meds.map((m) => m.value).join("\n");
}

export function renderAllergiesSection(model: EncounterModel): string {
  return renderList(model.history.allergies);
}

export function renderHabitsSection(model: EncounterModel): string {
  return renderList(model.history.habits);
}

export function renderFamilyHistorySection(model: EncounterModel): string {
  return renderList(model.history.family);
}

export function renderPersonalHistorySection(model: EncounterModel): string {
  return renderList(model.history.personal);
}

export function renderSocialHistorySection(model: EncounterModel): string {
  return renderList(model.history.social);
}

export function renderWorkHistorySection(model: EncounterModel): string {
  return renderList(model.history.work);
}

export function renderEpidemiologicalSection(model: EncounterModel): string {
  return renderList(model.history.epidemiological);
}
