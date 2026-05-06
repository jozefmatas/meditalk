/**
 * Pipeline session — the shared orchestration core for both
 * /api/generate and /api/adjust.
 *
 * Owns the full pipeline sequence:
 *   file-focus filter → skeleton ∥ ICD (parallel) → section loop
 *   (conclusion renders last, after ICD resolves) → HTML assembly.
 *
 * When `leafIdFilter` is set (adjust mode), only filtered sections
 * re-render; conclusion re-renders when it's in the filter set.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateNote } from "@/lib/sections/pipeline";
import { suggestIcdCodes } from "@/lib/sections/suggest-icd";
import type { SuggestedIcdCode } from "@/lib/sections/suggest-icd";
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
import { getActiveFeedback, buildFeedbackMap } from "@/lib/pipeline/feedback";
import { logger } from "@/lib/logger";

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
  /** Skip doctor feedback injection (adjust route — doctor steers via instructions). */
  skipFeedback?: boolean;
}

export interface PipelineSessionResult {
  generatedNote: string;
  sectionContents: Record<string, string>;
  templateId: string;
  clinicalAnalysis?: { suggestedIcdCodes: SuggestedIcdCode[] };
  updatedFileFocusCache?: FileFocusCache;
  /** Auto-generated title from skeleton's chief complaint. */
  suggestedTitle?: string;
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
    skipFeedback,
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

  // ── 3b. Doctor feedback injection ──────────────────────────────
  // Skipped for adjust routes (doctor steers via explicit instructions).
  let feedbackMap: Map<string, string> | undefined;
  if (!skipFeedback) {
    try {
      const feedback = await getActiveFeedback(
        input.supabase,
        userId,
        template.id,
      );
      if (feedback.length > 0) {
        feedbackMap = buildFeedbackMap(feedback, allIds);
      }
    } catch (err) {
      // Silently continue without feedback if query fails
      logger.warn("[session] Feedback query failed:", err);
    }
  }

  // ── 4. Section rendering ────────────────────────────────────────
  // ICD suggestions promise is passed into generateNote — conclusion
  // sections await it internally while other sections render in parallel.
  const sectionContentsMap: Record<string, string> = {
    ...(priorSectionContents ?? {}),
  };

  await generateNote({
    template,
    source,
    language,
    usage: { userId, visitId },
    skeleton,
    icdSuggestionsPromise: suggesterPromise,
    feedbackMap,
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

  // Resolve ICD results for the clinical analysis response.
  // The promise is already resolved (generateNote awaited it for
  // conclusion sections), so this is instant.
  const suggestedIcdCodes = await suggesterPromise;

  // ── 5. HTML assembly ────────────────────────────────────────────
  const generatedNote = buildTemplateHtml(
    template,
    sectionContentsMap,
    sectionLabels,
    { skipEmpty: true },
  );

  const clinicalAnalysis =
    suggestedIcdCodes.length > 0 ? { suggestedIcdCodes } : undefined;

  // ── 6. Auto-title from skeleton ─────────────────────────────────
  const suggestedTitle = skeleton?.suggestedTitle || undefined;

  return {
    generatedNote,
    sectionContents: sectionContentsMap,
    templateId: template.id,
    clinicalAnalysis,
    updatedFileFocusCache,
    suggestedTitle,
  };
}
