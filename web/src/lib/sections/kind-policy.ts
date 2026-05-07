/**
 * Section kind → policy mapping and passage-category routing.
 *
 * Extracted from `pipeline.ts` so the policy matrix is importable
 * without pulling in the full orchestration module.
 */
import type { SectionKind, TemplateSection } from "../templates/types";
import type { CriticModel } from "./critic";
import type { PassageCategory, RawSource } from "./section-agent";
import { normalizeLabel } from "../parse-note-sections";
import { logger } from "@/lib/logger";

// ─── Legacy label-matching fallback ──────────────────────────────────
//
// Prior to the `section.kind` field, the pipeline dispatched on label
// matching. These sets remain as a fallback for one release while
// existing templates are backfilled; every fallback hit is logged.
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
 * Build a kind-filtered copy of source for a specific section. File
 * passages with `classifiedPassages` are filtered to only the
 * categories relevant to the section's kind. Transcript and doctor
 * notes are always included in full.
 *
 * When files lack `classifiedPassages` (no directive / old cache),
 * the source is returned as-is — no filtering.
 */
export function filterSourceForKind(
  source: RawSource,
  kind: SectionKind,
): RawSource {
  if (!source.files?.some((f) => f.classifiedPassages?.length)) return source;

  const allowed = CATEGORY_ROUTING[kind];
  const filteredFiles = source.files!.map((f) => {
    if (!f.classifiedPassages?.length) return f;
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
