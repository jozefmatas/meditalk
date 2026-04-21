/**
 * Section pipeline — the ONLY orchestrator for note generation.
 *
 * Walks the template tree in order. For each leaf section that has a
 * `context` contract, calls the generic section-agent with the raw source
 * and all previously-rendered sections as context. Streams each completed
 * section through `onSection` so the UI can display them as they finish.
 *
 * No fact extraction, no EncounterModel, no clinical-specific magic.
 * Clinical knowledge lives in each section's admin-editable `context`
 * string + the reconcilers the section opts into.
 */
import type { Template, TemplateSection } from "../templates/types";
import type { SupportedLanguage } from "../types";
import {
  renderSection,
  type Language,
  type RawSource,
  type RenderedSection,
  type SectionConfig,
  type UsageContext,
} from "./section-agent";
import { logger } from "@/lib/logger";

export type OnSectionCallback = (
  section: RenderedSection,
) => void | Promise<void>;

export interface GenerateNoteInput {
  template: Template;
  source: RawSource;
  language: SupportedLanguage;
  /** Fired each time a section finishes rendering. */
  onSection?: OnSectionCallback;
  /** Propagates `userId` / `visitId` so each section's Claude call is logged. */
  usage?: UsageContext;
}

export interface GenerateNoteResult {
  /** Sections in render order (flattened; leaves only). */
  sections: RenderedSection[];
}

/**
 * Run the template end-to-end. Leaf sections with a non-empty `context`
 * are rendered in depth-first template order. Earlier sections are
 * passed to later ones as prior context for consistency / dedup.
 */
export async function generateNote(
  input: GenerateNoteInput,
): Promise<GenerateNoteResult> {
  const { template, source, language, onSection, usage } = input;
  const language4 = normalizeLanguage(language);
  const leaves = collectLeafSections(template.sections);
  const templateSystemPrompt = template.systemPrompt?.trim() || undefined;

  const rendered: RenderedSection[] = [];

  for (const leaf of leaves) {
    const title = resolveLabel(leaf, language4);
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
    };

    try {
      const result = await renderSection(
        source,
        config,
        rendered,
        language4,
        usage,
        templateSystemPrompt,
      );
      rendered.push(result);
      if (onSection) await onSection(result);
    } catch (err) {
      logger.error(`[pipeline] section ${leaf.id} failed:`, err);
      const empty: RenderedSection = { id: leaf.id, title, content: "" };
      rendered.push(empty);
      if (onSection) await onSection(empty);
    }
  }

  return { sections: rendered };
}

/**
 * Depth-first flatten: pick sections with no children OR with children
 * but no further nested children (i.e. render only leaf-level content).
 * A section whose only role is to group children (no context AND has
 * subsections) emits nothing itself — the client renders the parent
 * heading using the template, and the children's text fills the rest.
 */
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

/** Supported languages in the new pipeline mirror the legacy list. */
function normalizeLanguage(language: SupportedLanguage): Language {
  if (language === "sk" || language === "cs" || language === "en") {
    return language;
  }
  return "en";
}
