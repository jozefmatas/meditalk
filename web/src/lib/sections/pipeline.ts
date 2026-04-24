/**
 * Section pipeline — the ONLY orchestrator for note generation.
 *
 * Per-section flow:
 *   1. RENDER — section-agent (Haiku) reads raw source, uses
 *      `section.context` as its prose contract. Draft streams to the
 *      UI as soon as it finishes.
 *   2. CRITIC (opt-in) — when `section.critic` is true, a second Haiku
 *      call audits the draft against the raw source: removes invention,
 *      adds missed facts, preserves the draft's voice. Runs in parallel
 *      with the next section's render. Emits the corrected content via
 *      `onSection` again — the UI replaces by id.
 *   3. RECONCILERS — deterministic post-render helpers (drug-normalizer,
 *      icd-validator) run after the critic (or after the draft, when
 *      the critic is disabled).
 *
 * Záver is NOT rendered in this loop — the generate/regenerate route
 * pipes Záver from the ICD suggester through `runCriticAndReconcilers`
 * below so it gets the same treatment.
 */
import type {
  SectionKind,
  Template,
  TemplateSection,
} from "../templates/types";
import type { SupportedLanguage } from "../types";
import {
  renderSection,
  type Language,
  type RawSource,
  type RenderedSection,
  type SectionConfig,
  type UsageContext,
} from "./section-agent";
import { buildSectionExamplesMap } from "../templates/reference-notes";
import { normalizeLabel } from "../parse-note-sections";
import { criticPass, type CriticModel } from "./critic";
import type { NoteSkeleton } from "./note-skeleton";
import { RECONCILERS } from "./reconcilers";
import { logger } from "@/lib/logger";

// ─── Legacy label-matching fallback ──────────────────────────────────
//
// Prior to the `section.kind` field, the pipeline dispatched on label
// matching. These sets remain as a fallback for one release while
// existing templates are backfilled; every fallback hit is logged.
// New code should NEVER rely on these — use `resolveKind()` +
// `KIND_POLICY` instead.

const LEGACY_ZAVER_LABELS = new Set([
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

const LEGACY_LA_LABELS = new Set<string>([
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
    /** Critic tier for this section. */
    criticModel: CriticModel;
    /** Skip rendering in the main loop (Záver — populated externally). */
    skipRenderInMainLoop: boolean;
  }
> = {
  default: {
    skipVoiceExamples: false,
    digitGrounding: false,
    criticModel: "sonnet",
    skipRenderInMainLoop: false,
  },
  "history-narrative": {
    skipVoiceExamples: false,
    digitGrounding: false,
    criticModel: "sonnet",
    skipRenderInMainLoop: false,
  },
  "vital-numeric": {
    skipVoiceExamples: true,
    digitGrounding: true,
    criticModel: "sonnet",
    skipRenderInMainLoop: false,
  },
  "exam-narrative": {
    skipVoiceExamples: true,
    digitGrounding: false,
    criticModel: "sonnet",
    skipRenderInMainLoop: false,
  },
  "medication-list": {
    skipVoiceExamples: false,
    digitGrounding: false,
    // Haiku is more forgiving on med lists — Sonnet aggressively strips
    // chronic home meds the OCR mentions but that aren't explicitly
    // today's prescription (observed: Rytmonorm, Nolpaza).
    criticModel: "haiku",
    skipRenderInMainLoop: false,
  },
  conclusion: {
    skipVoiceExamples: false,
    digitGrounding: false,
    criticModel: "sonnet",
    skipRenderInMainLoop: true,
  },
};

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
  if (hit(LEGACY_ZAVER_LABELS)) derived = "conclusion";
  else if (hit(LEGACY_STRUCTURAL_VITAL_LABELS)) derived = "vital-numeric";
  else if (hit(LEGACY_EXAM_NARRATIVE_LABELS)) derived = "exam-narrative";
  else if (hit(LEGACY_LA_LABELS)) derived = "medication-list";

  logger.debug(
    `[pipeline] kind fallback: section id=${section.id} labels=${JSON.stringify(labels)} → ${derived}. Backfill via scripts/add-section-kind.mjs.`,
  );
  return derived;
}

/**
 * Title-based kind resolution for the Záver path, which reaches
 * `runCriticAndReconcilers` without a TemplateSection in hand — only
 * the resolved title string. Accepts an explicit kind when known.
 */
function resolveKindFromTitle(title: string, kind?: SectionKind): SectionKind {
  if (kind) return kind;
  const key = normalizeLabel(title);
  if (LEGACY_ZAVER_LABELS.has(key)) return "conclusion";
  if (LEGACY_STRUCTURAL_VITAL_LABELS.has(key)) return "vital-numeric";
  if (LEGACY_EXAM_NARRATIVE_LABELS.has(key)) return "exam-narrative";
  if (LEGACY_LA_LABELS.has(key)) return "medication-list";
  logger.debug(
    `[pipeline] kind fallback (title-only): "${title}" → default`,
  );
  return "default";
}


/**
 * Common Slovak medical transcription typos that slip past the
 * section-agent + critic. Each entry is [wrong, right]. Matching is
 * word-boundary + case-insensitive; the correction preserves the
 * original case pattern only when the wrong form is all-lowercase or
 * capitalised (MiXeD case like "HeMtÓMu" is normalised to "Hematómu").
 *
 * Keep the list SHORT and deterministic. Only add entries when the
 * wrong form is clearly nonsense Slovak — never fold legitimate
 * variants.
 */
const MEDICAL_TYPO_CORRECTIONS: Array<[wrong: string, right: string]> = [
  ["hemtóm", "hematóm"], // "hemtómu" → "hematómu" (observed in prod)
  ["infrkt", "infarkt"],
  ["dyspoe", "dyspnoe"],
  ["koronografia", "koronarografia"],
  ["echokardiogrfia", "echokardiografia"],
  ["hypertnzia", "hypertenzia"],
];

export function fixKnownMedicalTypos(text: string): string {
  if (!text.trim()) return text;
  let out = text;
  for (const [wrong, right] of MEDICAL_TYPO_CORRECTIONS) {
    // Replace the typo stem; Slovak case endings ("hemtómu", "hemtómom")
    // re-attach because we match the stem only.
    const escaped = wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "gi");
    out = out.replace(re, (match) => {
      // Preserve leading case: "Hemtóm" → "Hematóm", "hemtóm" → "hematóm".
      if (match[0] === match[0].toUpperCase()) {
        return right[0].toUpperCase() + right.slice(1);
      }
      return right;
    });
  }
  return out;
}

/**
 * For structural vital sections (Pulz / TK / Výška / Hmotnosť / BMI /
 * EKG), every Arabic-digit run in the draft must also appear in the
 * raw source blob. When ANY digit token is missing, strip the section
 * to empty — voice examples + ambient training data routinely leak
 * phantom "SF 68/min" / "TK 120/80" that the critic misses because the
 * numbers look clinically plausible.
 *
 * Digits are language-agnostic — this check works across sk/cs/en/any
 * locale that writes Arabic numerals. Does NOT attempt Slovak number
 * words ("sto tridsaťpäť"); if the model paraphrases word→digit, it
 * must do so with a digit actually present in the source, otherwise the
 * vital is dropped as ungrounded. That's the safe default.
 */
export function stripUngroundedVitalValue(
  draft: string,
  source: RawSource,
): string {
  const trimmed = draft.trim();
  if (!trimmed) return draft;

  const digitTokens = Array.from(trimmed.matchAll(/\d+/g)).map((m) => m[0]);
  if (digitTokens.length === 0) return draft;

  const sourceBlob = [
    source.transcript ?? "",
    source.doctorNotes ?? "",
    ...(source.files ?? []).map((f) => f.text ?? ""),
  ].join("\n");

  for (const tok of digitTokens) {
    if (!sourceBlob.includes(tok)) {
      logger.debug(
        `[pipeline] strip ungrounded vital: digit "${tok}" not in source — dropping "${trimmed.slice(0, 60)}"`,
      );
      return "";
    }
  }
  return draft;
}

export function findZaverSection(
  template: Template,
  language: Language = "sk",
): {
  id: string;
  title: string;
  context: string;
  reconcilers?: string[];
  critic?: boolean;
  kind?: SectionKind;
} | null {
  const walk = (sections: TemplateSection[]): TemplateSection | null => {
    for (const s of sections) {
      if (s.subsections?.length) {
        const hit = walk(s.subsections);
        if (hit) return hit;
      } else if (resolveKind(s) === "conclusion") {
        return s;
      }
    }
    return null;
  };
  const section = walk(template.sections);
  if (!section) return null;
  return {
    id: section.id,
    title: resolveLabel(section, language),
    context: section.context ?? "",
    reconcilers: section.reconcilers,
    critic: section.critic,
    kind: resolveKind(section),
  };
}

export type OnSectionCallback = (
  section: RenderedSection,
) => void | Promise<void>;

export interface GenerateNoteInput {
  template: Template;
  source: RawSource;
  language: SupportedLanguage;
  /**
   * Fired each time a section's state changes:
   *   - FIRST call per section id: the raw draft (streaming).
   *   - SECOND call per section id (optional): corrected critic output
   *     + reconcilers. UI replaces by id. Fires only on
   *     critic-enabled sections AND when the critic actually changed
   *     the content.
   */
  onSection?: OnSectionCallback;
  /** Propagates `userId` / `visitId` so each Claude call is logged. */
  usage?: UsageContext;
  /**
   * When provided, only render these leaf section ids. All other
   * leaves are skipped (the caller supplies their prior content). Used
   * by the /api/adjust route to re-render only the sections the
   * adjustment router flagged.
   */
  leafIdFilter?: Set<string>;
  /**
   * Shared encounter skeleton (chief complaint, encounter type, key
   * dates, providers). Pre-computed by `extractSkeleton()` in the
   * route, passed into every renderer + critic so sections see the
   * same cross-encounter context. `null` / omitted → pipeline renders
   * without a skeleton (today's behaviour).
   */
  skeleton?: NoteSkeleton | null;
}

export interface GenerateNoteResult {
  /** Sections in render order (flattened; leaves only) — FINAL. */
  sections: RenderedSection[];
}

export async function generateNote(
  input: GenerateNoteInput,
): Promise<GenerateNoteResult> {
  const {
    template,
    source,
    language,
    onSection,
    usage,
    leafIdFilter,
    skeleton,
  } = input;
  const language4 = normalizeLanguage(language);
  const allLeaves = collectLeafSections(template.sections);
  const leaves = leafIdFilter
    ? allLeaves.filter((l) => leafIdFilter.has(l.id))
    : allLeaves;
  if (leafIdFilter) {
    logger.debug(
      `[pipeline] generateNote leafIdFilter active: ${leaves.length}/${allLeaves.length} leaves will render`,
    );
  }
  const templateSystemPrompt = template.systemPrompt?.trim() || undefined;

  const sectionExamplesMap = buildSectionExamplesMap(
    template.styleExamples,
    template,
  );
  if (sectionExamplesMap.size > 0) {
    logger.debug(
      `[pipeline] section-examples corpus: ${sectionExamplesMap.size} section(s) have voice examples`,
    );
  }

  const final = new Map<string, RenderedSection>();
  const order: string[] = [];
  const criticPromises: Array<Promise<void>> = [];

  for (const leaf of leaves) {
    const title = resolveLabel(leaf, language4);
    const kind = resolveKind(leaf);
    const policy = KIND_POLICY[kind];

    if (policy.skipRenderInMainLoop) {
      logger.debug(
        `[pipeline] skipping section (${leaf.id}, kind=${kind}) — populated from external source (e.g. ICD suggester)`,
      );
      continue;
    }

    const context = leaf.context?.trim();
    if (!context) {
      logger.debug(`[pipeline] skipping ${leaf.id} — no context configured`);
      continue;
    }

    const config: SectionConfig = {
      id: leaf.id,
      title,
      context,
      model: leaf.model ?? "haiku",
      reconcilers: leaf.reconcilers,
      critic: leaf.critic,
      kind,
    };

    // Voice examples are suppressed for kinds where the few-shot
    // "example" IS a concrete finding (vitals numbers, normal-exam
    // boilerplate) — Haiku tends to mimic them even when today's
    // source has no corresponding data. Policy is declarative on
    // `kind`; the mapping lives in KIND_POLICY.
    const examples = policy.skipVoiceExamples
      ? undefined
      : sectionExamplesMap.get(leaf.id);
    if (policy.skipVoiceExamples) {
      logger.debug(
        `[pipeline] skipping examples for "${title}" (${leaf.id}, kind=${kind})`,
      );
    }

    let draft: RenderedSection;
    try {
      draft = await renderSection(
        source,
        config,
        language4,
        usage,
        templateSystemPrompt,
        examples,
        skeleton,
      );
    } catch (err) {
      logger.error(`[pipeline] section ${leaf.id} failed:`, err);
      draft = { id: leaf.id, title, content: "" };
    }

    // Structural-vital guard: ungrounded digits → strip the section.
    if (policy.digitGrounding && draft.content.trim()) {
      const grounded = stripUngroundedVitalValue(draft.content, source);
      if (grounded !== draft.content) draft = { ...draft, content: grounded };
    }

    // If no critic: run reconcilers immediately, then emit final.
    if (!config.critic) {
      const finalContent = applyReconcilers(
        draft.content,
        config.reconcilers,
        source,
        language4,
      );
      const result: RenderedSection = { ...draft, content: finalContent };
      order.push(result.id);
      final.set(result.id, result);
      if (onSection) await onSection(result);
      continue;
    }

    // Critic enabled: emit the draft right away so the UI streams,
    // then run the critic in the background. When it finishes, run
    // reconcilers on the critic output and emit the updated section.
    order.push(draft.id);
    final.set(draft.id, draft);
    if (onSection) await onSection(draft);

    const criticPromise = (async () => {
      try {
        // runCriticAndReconcilers is the single authority: it runs the
        // critic (when enabled), the structural-vital guard, and the
        // reconcilers. Whatever it returns IS the final content.
        const corrected = await runCriticAndReconcilers({
          draftContent: draft.content,
          source,
          config,
          language: language4,
          usage,
          templateSystemPrompt,
          sectionExamples: examples,
          skeleton,
        });
        if (corrected !== draft.content) {
          const updated: RenderedSection = {
            ...draft,
            content: corrected,
            draft: draft.content,
          };
          final.set(updated.id, updated);
          if (onSection) await onSection(updated);
        }
      } catch (err) {
        logger.error(`[pipeline] critic (bg) failed for ${leaf.id}:`, err);
        // Critic path failed — fall back to reconcilers-only on the
        // draft so the UI isn't stuck with uncorrected content a
        // deterministic reconciler could have fixed.
        try {
          const finalContent = applyReconcilers(
            draft.content,
            config.reconcilers,
            source,
            language4,
          );
          if (finalContent !== draft.content) {
            const updated: RenderedSection = {
              ...draft,
              content: finalContent,
            };
            final.set(updated.id, updated);
            if (onSection) await onSection(updated);
          }
        } catch (err2) {
          logger.error(
            `[pipeline] reconciler fallback failed for ${leaf.id}:`,
            err2,
          );
        }
      }
    })();
    criticPromises.push(criticPromise);
  }

  await Promise.all(criticPromises);

  const sections = order
    .map((id) => final.get(id))
    .filter((s): s is RenderedSection => !!s);
  return { sections };
}

/**
 * Run critic (if applicable) + reconcilers on a piece of section
 * content. Exported for the route to use on the Záver slot (fed by the
 * ICD suggester). Returns the final corrected content. Never throws —
 * falls back to draft-plus-reconcilers on critic failure.
 */
export async function runCriticAndReconcilers(args: {
  draftContent: string;
  source: RawSource;
  config: SectionConfig;
  language: Language;
  usage?: UsageContext;
  /**
   * Template-wide guardrails. When provided, the critic gets the same
   * voice/worldview the author was held to, so it doesn't strip
   * template conventions as "invention". Byte-identical between author
   * and critic → the Anthropic cache hits both.
   */
  templateSystemPrompt?: string;
  /**
   * Voice examples for THIS section (pre-selected from the template's
   * reference corpus — same `string[]` the section-agent received).
   * Lets the critic recognise legitimate voice instead of stripping it.
   */
  sectionExamples?: string[];
  /**
   * Shared encounter skeleton (same value the renderer saw). Propagated
   * so the critic has the cross-section picture and doesn't strip
   * skeleton-anchored facts as "invention". Source still wins when
   * the two conflict.
   */
  skeleton?: NoteSkeleton | null;
}): Promise<string> {
  const {
    draftContent,
    source,
    config,
    language,
    usage,
    templateSystemPrompt,
    sectionExamples,
    skeleton,
  } = args;
  if (!draftContent.trim()) return draftContent;

  let content = draftContent;

  // Dispatch on declarative kind. When the caller didn't populate
  // `config.kind` (e.g. the Záver path constructs a bare SectionConfig),
  // fall back to title-based matching + a legacy warn log.
  const kind = resolveKindFromTitle(config.title, config.kind);
  const policy = KIND_POLICY[kind];

  if (config.critic) {
    try {
      const criticModel: CriticModel = policy.criticModel;
      const result = await criticPass({
        draft: draftContent,
        source,
        sectionId: config.id,
        sectionTitle: config.title,
        sectionContext: config.context,
        language,
        usage,
        model: criticModel,
        templateSystemPrompt,
        sectionExamples,
        skeleton,
      });
      if (result.changed) {
        logger.debug(
          `[pipeline] critic (${criticModel}) modified "${config.title}" [${kind}] — ${result.diffSummary}`,
        );
      }
      content = result.content;
    } catch (err) {
      logger.error(`[pipeline] critic failed for "${config.title}":`, err);
    }
  }

  // Digit-grounding guard — catches phantom vital values the critic
  // either added or failed to strip. Only applies on vital-numeric.
  if (policy.digitGrounding && content.trim()) {
    content = stripUngroundedVitalValue(content, source);
  }

  // The critic already uses tool-use (`submit_corrected_section`) so
  // it can't leak meta-commentary essays; the section-agent handles its
  // own absence-description stripping via `isAbsenceDescription`.
  // `applyReconcilers` also runs the deterministic medical-typo fix.
  return applyReconcilers(content, config.reconcilers, source, language);
}

function applyReconcilers(
  content: string,
  names: string[] | undefined,
  source: RawSource,
  language: Language,
): string {
  let out = content;
  for (const name of names ?? []) {
    const reconciler = RECONCILERS[name];
    if (!reconciler) throw new Error(`Unknown reconciler: ${name}`);
    out = reconciler(out, source, { language });
  }
  // Universal last-pass: safe allowlist of Slovak medical typo fixes
  // (hemtóm → hematóm, etc.). Runs on every section, after any
  // configured reconcilers.
  return fixKnownMedicalTypos(out);
}

function collectLeafSections(sections: TemplateSection[]): TemplateSection[] {
  const out: TemplateSection[] = [];
  for (const s of sections) {
    if (s.subsections && s.subsections.length > 0) {
      out.push(...collectLeafSections(s.subsections));
    } else {
      out.push(s);
    }
  }
  return out;
}

function resolveLabel(section: TemplateSection, language: Language): string {
  return (
    section.labels[language] ??
    section.labels.en ??
    section.labels[Object.keys(section.labels)[0]] ??
    section.id
  );
}

function normalizeLanguage(language: SupportedLanguage): Language {
  if (language === "sk" || language === "cs" || language === "en") {
    return language;
  }
  return "en";
}
