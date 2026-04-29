/**
 * Pipeline session — the shared orchestration core for both
 * /api/generate and /api/adjust.
 *
 * Owns the full pipeline sequence:
 *   file-focus filter → skeleton ∥ ICD (parallel) → section loop
 *   → Záver (format + critic + reconcilers) → HTML assembly.
 *
 * When `leafIdFilter` is set (adjust mode), only filtered sections
 * re-render; Záver is conditional on whether diagnosis-affecting
 * sections are in the filter.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateNote,
  findZaverSection,
  runCriticAndReconcilers,
} from "@/lib/sections/pipeline";
import { suggestIcdCodes } from "@/lib/sections/suggest-icd";
import type { SuggestedIcdCode } from "@/lib/sections/suggest-icd";
import { formatZaverFromSuggestions } from "@/lib/sections/format-zaver";
import {
  applyFileFocusDirectives,
  type FileFocusCache,
} from "@/lib/sections/file-focus";
import { extractSkeleton } from "@/lib/sections/note-skeleton";
import { buildSectionLabelsFromTemplate } from "@/lib/templates";
import { buildTemplateHtml, flattenSectionIds } from "@/lib/templates/html";
import type { RawSource } from "@/lib/sections/section-agent";
import type { Template } from "@/lib/templates/types";
import type { SupportedLanguage } from "@/lib/types";
import { shouldRerunZaver } from "./adjust-helpers";

// ── Public types ──────────────────────────────────────────────────

export interface PipelineSessionInput {
  supabase: SupabaseClient;
  userId: string;
  visitId: string;
  language: SupportedLanguage;
  rawSource: RawSource;
  fileIds: string[];
  visitMetadata: Record<string, unknown>;
  template: Template;
  sendEvent: (data: Record<string, unknown>) => void;
  /** Adjust-specific: only re-render these leaf sections. */
  leafIdFilter?: Set<string>;
  /** Adjust-specific: prior section contents for seeding. */
  priorSectionContents?: Record<string, string>;
}

export interface PipelineSessionResult {
  generatedNote: string;
  sectionContents: Record<string, string>;
  templateId: string;
  clinicalAnalysis?: { suggestedIcdCodes: SuggestedIcdCode[] };
  updatedFileFocusCache?: FileFocusCache;
}

// ── Implementation ────────────────────────────────────────────────

export async function runPipelineSession(
  input: PipelineSessionInput,
): Promise<PipelineSessionResult> {
  const {
    userId,
    visitId,
    language,
    rawSource,
    fileIds,
    visitMetadata,
    template,
    sendEvent,
    leafIdFilter,
    priorSectionContents,
  } = input;

  const allIds = flattenSectionIds(template);
  const sectionLabels = buildSectionLabelsFromTemplate(template, language);

  // ── 1. File-focus filter ────────────────────────────────────────
  const fileFocusCache = (visitMetadata.file_focus_cache ??
    {}) as FileFocusCache;
  let updatedFileFocusCache: FileFocusCache | undefined;

  const source = await applyFileFocusDirectives(
    rawSource,
    language,
    { userId, visitId },
    {
      fileIds,
      cache: fileFocusCache,
      onCacheUpdate: (next) => {
        updatedFileFocusCache = next;
      },
    },
  );

  // ── 2. Emit streaming_start ─────────────────────────────────────
  sendEvent({
    type: "streaming_start",
    sectionIds: allIds,
    sectionLabels,
    ...(priorSectionContents ? { seed: priorSectionContents } : {}),
  });

  // ── 3. Skeleton + ICD in parallel ───────────────────────────────
  const skeletonPromise = extractSkeleton(source, language, {
    userId,
    visitId,
  });

  const suggesterPromise = suggestIcdCodes(source, language, {
    userId,
    visitId,
  });

  // Await skeleton before section rendering so every renderer has it
  const skeleton = await skeletonPromise;

  // ── 4. Section rendering ────────────────────────────────────────
  const sectionContentsMap: Record<string, string> = {
    ...(priorSectionContents ?? {}),
  };

  const sectionsPromise = generateNote({
    template,
    source,
    language,
    usage: { userId, visitId },
    skeleton,
    ...(leafIdFilter ? { leafIdFilter } : {}),
    onSection: (section) => {
      sectionContentsMap[section.id] = section.content;
      sendEvent({
        type: "section",
        id: section.id,
        title: section.title,
        content: section.content,
      });
    },
  });

  const [, suggestedIcdCodes] = await Promise.all([
    sectionsPromise,
    suggesterPromise,
  ]);

  // ── 5. Záver ────────────────────────────────────────────────────
  const zaver = findZaverSection(
    template,
    language === "cs" ? "cs" : language === "en" ? "en" : "sk",
  );

  const runZaver = leafIdFilter
    ? shouldRerunZaver(zaver, leafIdFilter, template, sectionLabels)
    : !!zaver;

  if (runZaver && zaver) {
    const draftZaver = formatZaverFromSuggestions(suggestedIcdCodes);
    const finalZaver = draftZaver
      ? await runCriticAndReconcilers({
          draftContent: draftZaver,
          source,
          config: {
            id: zaver.id,
            title: zaver.title,
            context: zaver.context,
            model: "haiku",
            reconcilers: zaver.reconcilers,
            critic: zaver.critic,
            kind: zaver.kind,
          },
          language: language === "cs" ? "cs" : language === "en" ? "en" : "sk",
          usage: { userId, visitId },
          templateSystemPrompt: template.systemPrompt,
          skeleton,
        })
      : draftZaver;

    if (finalZaver !== undefined) {
      sectionContentsMap[zaver.id] = finalZaver;
      sendEvent({
        type: "section",
        id: zaver.id,
        title: zaver.title,
        content: finalZaver,
      });
    }
  }

  // ── 6. HTML assembly ────────────────────────────────────────────
  const generatedNote = buildTemplateHtml(
    template,
    sectionContentsMap,
    sectionLabels,
    { skipEmpty: true },
  );

  const clinicalAnalysis =
    suggestedIcdCodes.length > 0 ? { suggestedIcdCodes } : undefined;

  return {
    generatedNote,
    sectionContents: sectionContentsMap,
    templateId: template.id,
    clinicalAnalysis,
    updatedFileFocusCache,
  };
}
