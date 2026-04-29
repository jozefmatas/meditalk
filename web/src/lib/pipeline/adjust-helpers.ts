/**
 * Adjust-specific utilities — extracted from adjust/route.ts.
 *
 * Contains the vital-group expansion logic, label folding, and the
 * Záver re-run decision, plus the router's section collector.
 */
import type { Template, TemplateSection } from "@/lib/templates/types";

// ── Vital / exam labels ──────────────────────────────────────────

export const VITAL_EXAM_LABELS = new Set([
  "krvny tlak",
  "tk",
  "pulz",
  "sf",
  "vyska",
  "hmotnost",
  "bmi",
  "ekg",
  "ecg",
  "celkove vysetrenie",
  "celkovy stav",
  "celkovy nalez",
  "fyzikalne vysetrenie",
  "fyzikalni vysetreni",
  "objektivne vysetrenie",
  "objektivni vysetreni",
  "height",
  "weight",
  "blood pressure",
  "heart rate",
  "general condition",
  "general examination",
  "physical examination",
]);

/**
 * Strip diacritics, lowercase, trim trailing colons/whitespace.
 */
export function foldLabel(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[:\s]+$/g, "");
}

/**
 * Check whether a label belongs to the physical-exam / vitals group.
 */
export function isVitalOrExamLabel(label: string): boolean {
  return VITAL_EXAM_LABELS.has(foldLabel(label));
}

// ── Router section collector ─────────────────────────────────────

/**
 * Build the router's section list — each leaf's id + display label +
 * one-line contract hint.
 */
export function collectLeafSectionsForRouter(
  template: Template,
  sectionLabels: Record<string, string>,
): Array<{ id: string; label: string; contractHint: string }> {
  const out: Array<{ id: string; label: string; contractHint: string }> = [];
  const walk = (nodes: TemplateSection[]) => {
    for (const s of nodes) {
      if (s.subsections?.length) {
        walk(s.subsections);
        continue;
      }
      const label = sectionLabels[s.id] ?? s.id;
      const hint =
        (s.context ?? "").split(/\n/)[0]?.slice(0, 160)?.trim() ?? "";
      out.push({ id: s.id, label, contractHint: hint });
    }
  };
  walk(template.sections);
  return out;
}

// ── Záver re-run decision ────────────────────────────────────────

/**
 * Decide whether the Záver section should be re-run after an adjust.
 *
 * Re-runs when:
 * - The Záver section itself is in the affected set, OR
 * - Any diagnosis-affecting section (OA, TO, anamneza, HPI, PMH) is affected.
 */
export function shouldRerunZaver(
  zaver: { id: string } | null | undefined,
  affectedSet: Set<string>,
  template: Template,
  sectionLabels: Record<string, string>,
): boolean {
  if (!zaver) return false;
  if (affectedSet.has(zaver.id)) return true;

  const leafSections = collectLeafSectionsForRouter(template, sectionLabels);
  return leafSections.some(
    (s) =>
      affectedSet.has(s.id) &&
      /^(oa|osobna|past\s+medical|pmh|to|terajsie|hpi|history|anamneza)/i.test(
        s.id + " " + s.label,
      ),
  );
}

// ── Vital-group expansion ────────────────────────────────────────

/**
 * If ANY vital/exam section is in the affected set, expand to include
 * ALL vital/exam sections — prevents stale cross-talk from surviving
 * (e.g. doctor dictates only TK; Pulz and EKG must also reconsider).
 */
export function expandVitalGroup(
  affectedSet: Set<string>,
  template: Template,
  sectionLabels: Record<string, string>,
): Set<string> {
  const leafSections = collectLeafSectionsForRouter(template, sectionLabels);
  const vitalGroupIds = leafSections
    .filter((s) => isVitalOrExamLabel(s.label))
    .map((s) => s.id);

  if (vitalGroupIds.some((id) => affectedSet.has(id))) {
    const expanded = new Set(affectedSet);
    for (const id of vitalGroupIds) expanded.add(id);
    return expanded;
  }
  return affectedSet;
}
