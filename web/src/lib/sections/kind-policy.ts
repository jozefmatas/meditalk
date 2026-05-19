/**
 * Kind policy — per-section behaviour matrix and routing tables.
 *
 * Extracted from `pipeline.ts` so consumers can read the dispatch rules
 * without pulling in the full orchestrator (generateNote, critic, etc.).
 *
 * - `KIND_POLICY` — render/critic tiers and grounding flags per kind.
 * - `CATEGORY_ROUTING` — which passage categories each kind accepts.
 * - `filterSourceForKind` — kind-filtered copy of source for a section.
 * - `resolveKind` / `resolveKindFromTitle` — kind resolution with
 *   legacy label-set fallback (logs every fallback hit).
 */
import type { SectionKind, TemplateSection } from "../templates/types";
import type { PassageCategory, RawSource } from "./section-agent";
import type { CriticModel } from "./critic";
import { normalizeLabel } from "../parse-note-sections";
import { logger } from "@/lib/logger";

// ─── Legacy label-matching fallback ──────────────────────────────────
//
// Prior to the `section.kind` field, the pipeline dispatched on label
// matching. These sets remain as a fallback for one release while
// existing templates are backfilled; every fallback hit is logged.
//
// New code should NEVER rely on these — use `resolveKind()` +
// `KIND_POLICY` instead.

const CONCLUSION_LABELS = new Set([
  "zaver",
  "assessment",
  "conclusion",
  "diagnosis",
  "diagnostic assessment",
]);

const LEGACY_STRUCTURAL_VITAL_LABELS = new Set([
  "vyska",
  "hmotnost",
  "bmi",
  "krvny tlak",
  "tk",
  "pulz",
  "sf",
  "ekg",
  "ecg",
  "height",
  "weight",
  "blood pressure",
  "heart rate",
]);

const LEGACY_EXAM_NARRATIVE_LABELS = new Set([
  "celkove vysetrenie",
  "celkovy stav",
  "celkovy nalez",
  "fyzikalne vysetrenie",
  "fyzikalni vysetreni",
  "objektivne vysetrenie",
  "objektivni vysetreni",
  "general examination",
  "general condition",
  "physical examination",
  "physical exam",
]);

const MEDICATION_LIST_LABELS = new Set<string>([
  "la",
  "liekova anamneza",
  "lekova anamneza",
  "medications",
  "current medications",
  "medication list",
  "home medications",
  "meds",
]);

/** Per-section behaviour matrix, dispatched on `kind`. One-screen view. */
export const KIND_POLICY: Record<
  SectionKind,
  {
    /** Skip voice examples in the renderer (prevents boilerplate leak). */
    skipVoiceExamples: boolean;
    /** Enforce that every Arabic digit in the draft appears in source. */
    digitGrounding: boolean;
    /** Critic tier — always Haiku (verification ≠ generation). */
    criticModel: CriticModel;
    /** Default render model when template doesn't override. */
    renderModel: "haiku" | "sonnet";
  }
> = {
  default: {
    skipVoiceExamples: false,
    digitGrounding: false,
    criticModel: "haiku",
    renderModel: "haiku",
  },
  "history-narrative": {
    skipVoiceExamples: false,
    digitGrounding: false,
    criticModel: "haiku",
    renderModel: "sonnet",
  },
  "vital-numeric": {
    skipVoiceExamples: true,
    digitGrounding: true,
    criticModel: "haiku",
    renderModel: "haiku",
  },
  "exam-narrative": {
    skipVoiceExamples: true,
    digitGrounding: false,
    criticModel: "haiku",
    renderModel: "sonnet",
  },
  "medication-list": {
    skipVoiceExamples: false,
    digitGrounding: false,
    criticModel: "haiku",
    renderModel: "haiku",
  },
  // Conclusion is deterministic (no LLM render). renderModel is unused
  // but kept for type completeness. See formatConclusionContent().
  conclusion: {
    skipVoiceExamples: false,
    digitGrounding: false,
    criticModel: "haiku",
    renderModel: "sonnet",
  },
};

// ─── Passage-category routing ────────────────────────────────────────
//
// When file-focus extraction classifies passages, each section kind
// receives only the categories relevant to it. `default` gets
// everything (no filter). Transcript and doctor notes are always
// unfiltered — classification applies to file passages only.

const ALL_CATEGORIES = new Set<PassageCategory>([
  "medication",
  "diagnosis",
  "finding",
  "procedure",
  "vital",
  "history",
  "general",
]);

export const CATEGORY_ROUTING: Record<SectionKind, Set<PassageCategory>> = {
  "medication-list": new Set(["medication", "general"]),
  conclusion: new Set(["diagnosis", "finding", "general"]),
  "exam-narrative": new Set(["finding", "vital", "general"]),
  "history-narrative": new Set(["history", "finding", "diagnosis", "general"]),
  "vital-numeric": new Set(["vital", "general"]),
  default: ALL_CATEGORIES,
};

/**
 * Section kinds that should only see current-visit data. Files that
 * went through file-focus (Past mode — directive present) are excluded
 * entirely so past vitals/exam findings don't leak into today's exam.
 */
const CURRENT_VISIT_ONLY: Set<SectionKind> = new Set([
  "exam-narrative",
  "vital-numeric",
]);

/**
 * Build a kind-filtered copy of source for a specific section. File
 * passages with `classifiedPassages` are filtered to only the
 * categories relevant to the section's kind. Transcript and doctor
 * notes are always included in full.
 *
 * "Past" mode detection uses the `context` field (doctor's directive)
 * — NOT `classifiedPassages`, which can be empty when the file-focus
 * fallback triggers (all passages failed validation → full text returned).
 *
 * For current-visit-only sections (exam-narrative, vital-numeric),
 * past-mode files are excluded entirely — these sections should only
 * reflect today's data (transcript, doctor notes, "Actual" mode files).
 */
export function filterSourceForKind(
  source: RawSource,
  kind: SectionKind,
): RawSource {
  const hasPastFiles = source.files?.some(
    (f) => f.classifiedPassages?.length || f.context?.trim(),
  );
  if (!hasPastFiles) return source;

  const allowed = CATEGORY_ROUTING[kind];
  const excludePastFiles = CURRENT_VISIT_ONLY.has(kind);
  const filteredFiles = source.files!.map((f) => {
    const isPastMode = !!(f.classifiedPassages?.length || f.context?.trim());
    if (!isPastMode) return f; // "Actual" mode — pass through.
    // Past-mode files should not contribute to current-visit sections.
    if (excludePastFiles) return { ...f, text: "" };
    // Category filter for sections that accept past-file data.
    if (!f.classifiedPassages?.length) return f; // Fallback: no passages to filter.
    const kept = f.classifiedPassages.filter((p) => allowed.has(p.category));
    return { ...f, text: kept.map((p) => p.text).join("\n\n") };
  });

  return { ...source, files: filteredFiles };
}

/**
 * Resolve a section's `kind`, using the legacy label sets as a
 * fallback when the field isn't set. Logs every fallback so we can
 * audit stragglers and retire the legacy sets after backfill.
 */
export function resolveKind(section: TemplateSection): SectionKind {
  if (section.kind) return section.kind;

  const labels = Object.values(section.labels ?? {});
  const hit = (set: Set<string>): boolean =>
    labels.some((l) => typeof l === "string" && set.has(normalizeLabel(l)));

  let derived: SectionKind = "default";
  if (hit(CONCLUSION_LABELS)) derived = "conclusion";
  else if (hit(LEGACY_STRUCTURAL_VITAL_LABELS)) derived = "vital-numeric";
  else if (hit(LEGACY_EXAM_NARRATIVE_LABELS)) derived = "exam-narrative";
  else if (hit(MEDICATION_LIST_LABELS)) derived = "medication-list";

  logger.debug(
    `[pipeline] kind fallback: section id=${section.id} labels=${JSON.stringify(labels)} → ${derived}. Backfill via scripts/add-section-kind.mjs.`,
  );
  return derived;
}

/**
 * Title-based kind resolution fallback for callers that reach
 * `runCriticAndReconcilers` without a TemplateSection — only the
 * resolved title string. Accepts an explicit kind when known.
 */
export function resolveKindFromTitle(
  title: string,
  kind?: SectionKind,
): SectionKind {
  if (kind) return kind;
  const key = normalizeLabel(title);
  if (CONCLUSION_LABELS.has(key)) return "conclusion";
  if (LEGACY_STRUCTURAL_VITAL_LABELS.has(key)) return "vital-numeric";
  if (LEGACY_EXAM_NARRATIVE_LABELS.has(key)) return "exam-narrative";
  if (MEDICATION_LIST_LABELS.has(key)) return "medication-list";
  logger.debug(`[pipeline] kind fallback (title-only): "${title}" → default`);
  return "default";
}
