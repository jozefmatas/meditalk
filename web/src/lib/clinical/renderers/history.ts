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
import { extractBaseName } from "../medication-index";

/** Diacritic-strip + lowercase for dedup key. */
function normalizeForDedup(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Generic per-subject dedup. When two facts share the same normalized
 * first 3-word subject, keep the longer (more informative) one. Works
 * well for habits like "cigarety: neguje" + "nefajčí" → keep the one
 * with more context.
 */
function dedupBySubject(refs: FactRef[]): FactRef[] {
  const kept: FactRef[] = [];
  const seen = new Map<string, FactRef>();
  for (const r of refs) {
    const first3 = normalizeForDedup(r.value).split(/[\s,:.]+/).slice(0, 2).join(" ");
    const existing = seen.get(first3);
    if (!existing) {
      seen.set(first3, r);
      kept.push(r);
      continue;
    }
    if (r.value.length > existing.value.length) {
      // Replace the earlier shorter variant with the longer one.
      const idx = kept.indexOf(existing);
      if (idx >= 0) kept[idx] = r;
      seen.set(first3, r);
    }
  }
  return kept;
}

/** Render a list of fact refs as "A, B, C." with period. */
function renderList(refs: FactRef[]): string {
  if (refs.length === 0) return "";
  // Per-subject dedup so habits like "alkohol: príležitostne" +
  // "alkohol nepije" don't both ship. Longer wording wins.
  const deduped = dedupBySubject(refs);
  // Preserve fact value verbatim; negated facts carry a compact prefix
  // so the doctor immediately sees what is absent. Full per-locale
  // negation rendering moves to the specialty pack in Phase 5.
  const parts = deduped.map((r) =>
    r.negated ? `neguje ${r.value}` : r.value,
  );
  return parts.join(", ") + (parts.some(Boolean) ? "." : "");
}

/**
 * Dedup medication fact refs by base drug name.
 *
 * The extractor frequently produces two variants of the same med — a
 * short form ("Rytmonorm 1-0-1") and a dose form ("Rytmonorm 325 mg
 * 1-0-1"). We keep the LONGER (more informative) one per base name.
 */
function dedupMedications(refs: FactRef[]): FactRef[] {
  const byBase = new Map<string, FactRef>();
  for (const r of refs) {
    const base = normalizeForDedup(extractBaseName(r.value));
    if (!base) continue;
    const existing = byBase.get(base);
    if (!existing) {
      byBase.set(base, r);
      continue;
    }
    if (r.value.length > existing.value.length) byBase.set(base, r);
  }
  return Array.from(byBase.values());
}

export function renderMedicationsSection(model: EncounterModel): string {
  const meds = dedupMedications(model.history.medications);
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
