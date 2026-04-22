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
import type { Template, TemplateSection } from "../templates/types";
import type { SupportedLanguage } from "../types";
import {
  renderSection,
  isAbsenceDescription,
  type Language,
  type RawSource,
  type RenderedSection,
  type SectionConfig,
  type UsageContext,
} from "./section-agent";
import { buildSectionExamplesMap } from "../templates/reference-notes";
import { normalizeLabel } from "../parse-note-sections";
import { criticPass } from "./critic";
import { RECONCILERS } from "./reconcilers";
import { logger } from "@/lib/logger";

const ZAVER_LABELS = new Set([
  "zaver",
  "assessment",
  "conclusion",
  "diagnosis",
  "diagnostic assessment",
]);

function isZaverSection(section: TemplateSection): boolean {
  return Object.values(section.labels ?? {}).some(
    (l) => typeof l === "string" && ZAVER_LABELS.has(normalizeLabel(l)),
  );
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
} | null {
  const walk = (sections: TemplateSection[]): TemplateSection | null => {
    for (const s of sections) {
      if (s.subsections?.length) {
        const hit = walk(s.subsections);
        if (hit) return hit;
      } else if (isZaverSection(s)) {
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
}

export interface GenerateNoteResult {
  /** Sections in render order (flattened; leaves only) — FINAL. */
  sections: RenderedSection[];
}

export async function generateNote(
  input: GenerateNoteInput,
): Promise<GenerateNoteResult> {
  const { template, source, language, onSection, usage } = input;
  const language4 = normalizeLanguage(language);
  const leaves = collectLeafSections(template.sections);
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

    if (isZaverSection(leaf)) {
      logger.debug(
        `[pipeline] skipping Záver section (${leaf.id}) — populated from ICD suggester`,
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
    };

    let draft: RenderedSection;
    try {
      draft = await renderSection(
        source,
        config,
        language4,
        usage,
        templateSystemPrompt,
        sectionExamplesMap.get(leaf.id),
      );
    } catch (err) {
      logger.error(`[pipeline] section ${leaf.id} failed:`, err);
      draft = { id: leaf.id, title, content: "" };
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
        const corrected = await runCriticAndReconcilers({
          draftContent: draft.content,
          source,
          config,
          language: language4,
          usage,
        });
        if (corrected !== draft.content) {
          const updated: RenderedSection = {
            ...draft,
            content: corrected,
            draft: draft.content,
          };
          final.set(updated.id, updated);
          if (onSection) await onSection(updated);
        } else {
          // No change — still apply reconcilers (critic doesn't, it's a
          // different responsibility). But in the common case (critic
          // returned unchanged AND reconcilers don't change either), the
          // draft is the final. Apply reconcilers anyway for safety.
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
        }
      } catch (err) {
        logger.error(`[pipeline] critic (bg) failed for ${leaf.id}:`, err);
        // On critic failure, still run reconcilers and emit so the UI
        // isn't left with the raw draft when a deterministic fix could
        // have applied.
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
}): Promise<string> {
  const { draftContent, source, config, language, usage } = args;
  if (!draftContent.trim()) return draftContent;

  let content = draftContent;

  if (config.critic) {
    try {
      const result = await criticPass({
        draft: draftContent,
        source,
        sectionId: config.id,
        sectionTitle: config.title,
        sectionContext: config.context,
        language,
        usage,
      });
      if (result.changed) {
        logger.debug(
          `[pipeline] critic modified "${config.title}" — ${result.diffSummary}`,
        );
      }
      content = result.content;
    } catch (err) {
      logger.error(`[pipeline] critic failed for "${config.title}":`, err);
    }
  }

  // Safety net — strip absence-description leaks from the critic output
  // (same guard the section-agent applies to its own draft).
  if (isAbsenceDescription(content)) {
    content = "";
  }

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
  return out;
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
