/**
 * Section pipeline — the ONLY orchestrator for note generation.
 *
 * Per-section flow:
 *   1. RENDER — section-agent reads raw source, uses `section.context`
 *      as its prose contract. Model tier per section kind: Sonnet for
 *      narrative, Haiku for structural/default. Draft streams to the UI
 *      as soon as it finishes.
 *   2. CRITIC (opt-in) — when `section.critic` is true, a Haiku call
 *      audits the draft against the raw source: removes invention,
 *      adds missed facts, preserves the draft's voice. Always Haiku.
 *      Runs in parallel with the next section's render. Emits the
 *      corrected content via `onSection` again — the UI replaces by id.
 *   3. RECONCILERS — deterministic post-render helpers (drug-normalizer,
 *      icd-validator) run after the critic (or after the draft, when
 *      the critic is disabled).
 *
 * Conclusion (Záver) is DETERMINISTIC — no LLM call. It waits for the
 * ICD suggester to resolve, then formats high/medium-confidence
 * diagnoses as canonical descriptions (one per line, no ICD codes).
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
import type { SuggestedIcdCode } from "./suggest-icd";
import { buildSectionExamplesMap } from "../templates/reference-notes";
import { criticPass, type CriticModel } from "./critic";
import type { NoteSkeleton } from "./note-skeleton";
import { RECONCILERS } from "./reconcilers";
import { drugSubstitutionGuard } from "./reconcilers/drug-substitution-guard";
import {
  KIND_POLICY,
  filterSourceForKind,
  resolveKind,
  resolveKindFromTitle,
} from "./kind-policy";
import { logger } from "@/lib/logger";

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

export function findConclusionSection(
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
  /**
   * Promise resolving to ICD suggestions from the suggester. Conclusion
   * sections await this before rendering so the section-agent receives
   * pre-validated diagnoses as structured context. Other section kinds
   * ignore it. When omitted, conclusion renders without ICD context.
   */
  icdSuggestionsPromise?: Promise<SuggestedIcdCode[]>;
  /**
   * Per-section feedback blocks from doctor corrections. Built by
   * `buildFeedbackMap()`. Keys = section IDs, values = formatted
   * `# Prior corrections` prompt blocks.
   */
  feedbackMap?: Map<string, string>;
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
    icdSuggestionsPromise,
    feedbackMap,
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

  // Conclusion sections render last — they need ICD suggestions as
  // context, which resolve in parallel with the other sections.
  const nonConclusionLeaves = leaves.filter(
    (l) => resolveKind(l) !== "conclusion",
  );
  const conclusionLeaves = leaves.filter(
    (l) => resolveKind(l) === "conclusion",
  );

  const final = new Map<string, RenderedSection>();
  const order: string[] = [];
  const criticPromises: Array<Promise<void>> = [];

  // Helper: render one leaf, emit draft, queue critic.
  const renderLeaf = async (
    leaf: TemplateSection,
    additionalContext?: string,
  ) => {
    const title = resolveLabel(leaf, language4);
    const kind = resolveKind(leaf);
    const policy = KIND_POLICY[kind];

    const context = leaf.context?.trim();
    if (!context) {
      logger.debug(`[pipeline] skipping ${leaf.id} — no context configured`);
      return;
    }

    // Filter file passages by category for this section's kind.
    // Both renderer AND critic see the same filtered source so the
    // critic doesn't flag "missed" passages that were intentionally
    // routed away from this section.
    const sectionSource = filterSourceForKind(source, kind);

    const config: SectionConfig = {
      id: leaf.id,
      title,
      context,
      model: leaf.model ?? policy.renderModel,
      reconcilers: leaf.reconcilers,
      critic: leaf.critic,
      kind,
    };

    const examples = policy.skipVoiceExamples
      ? undefined
      : sectionExamplesMap.get(leaf.id);
    if (policy.skipVoiceExamples) {
      logger.debug(
        `[pipeline] skipping examples for "${title}" (${leaf.id}, kind=${kind})`,
      );
    }

    const feedbackBlock = feedbackMap?.get(leaf.id);

    let draft: RenderedSection;
    try {
      draft = await renderSection(
        sectionSource,
        config,
        language4,
        usage,
        templateSystemPrompt,
        examples,
        skeleton,
        additionalContext,
        feedbackBlock,
      );
    } catch (err) {
      logger.error(`[pipeline] section ${leaf.id} failed:`, err);
      draft = { id: leaf.id, title, content: "" };
    }

    // Structural-vital guard: ungrounded digits → strip the section.
    if (policy.digitGrounding && draft.content.trim()) {
      const grounded = stripUngroundedVitalValue(draft.content, sectionSource);
      if (grounded !== draft.content) draft = { ...draft, content: grounded };
    }

    // If no critic: run reconcilers immediately, then emit final.
    if (!config.critic) {
      const finalContent = applyReconcilers(
        draft.content,
        config.reconcilers,
        sectionSource,
        language4,
      );
      const result: RenderedSection = { ...draft, content: finalContent };
      order.push(result.id);
      final.set(result.id, result);
      if (onSection) await onSection(result);
      return;
    }

    // Critic enabled: emit the draft right away so the UI streams,
    // then run the critic in the background.
    order.push(draft.id);
    final.set(draft.id, draft);
    if (onSection) await onSection(draft);

    const criticPromise = (async () => {
      try {
        const corrected = await runCriticAndReconcilers({
          draftContent: draft.content,
          source: sectionSource,
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
        try {
          const finalContent = applyReconcilers(
            draft.content,
            config.reconcilers,
            sectionSource,
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
  };

  // Render non-conclusion sections (runs in parallel with ICD suggester)
  for (const leaf of nonConclusionLeaves) {
    await renderLeaf(leaf);
  }

  // Conclusion is deterministic — format ICD suggestions, no LLM call.
  if (conclusionLeaves.length > 0) {
    let icdCodes: SuggestedIcdCode[] = [];
    if (icdSuggestionsPromise) {
      try {
        icdCodes = await icdSuggestionsPromise;
      } catch (err) {
        logger.error("[pipeline] ICD suggester failed for conclusion:", err);
      }
    }
    const content = formatConclusionContent(icdCodes);
    for (const leaf of conclusionLeaves) {
      const title = resolveLabel(leaf, language4);
      const result: RenderedSection = { id: leaf.id, title, content };
      order.push(result.id);
      final.set(result.id, result);
      if (onSection) await onSection(result);
    }
  }

  await Promise.all(criticPromises);

  const sections = order
    .map((id) => final.get(id))
    .filter((s): s is RenderedSection => !!s);
  return { sections };
}

/**
 * Deterministic conclusion formatter. Takes ICD suggestions from the
 * suggester and returns canonical descriptions joined by `<br>`.
 *
 * Uses `<br>` (not `\n`) so both `contentToEditorHtml` and
 * `renderContent` keep everything in a single `<p>` — producing
 * shift+enter-style tight line breaks. Separate `<p>` tags create
 * paragraph gaps that are impossible to remove in NIS (hospital
 * information systems).
 *
 * Only high/medium confidence codes.
 * No ICD code numbers — those live exclusively in the right-side panel.
 */
export function formatConclusionContent(codes: SuggestedIcdCode[]): string {
  const relevant = codes.filter((c) => c.confidence !== "low");
  if (relevant.length === 0) return "";
  return relevant.map((c) => c.description).join("<br>");
}

/**
 * Run critic (if applicable) + reconcilers on a piece of section
 * content. Returns the final corrected content. Never throws —
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
  // Universal first-pass: revert any brand↔generic drug name
  // substitutions the LLM made. Runs before per-section reconcilers
  // so the drug-normalizer sees source-faithful names.
  let out = drugSubstitutionGuard(content, source, { language });
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
