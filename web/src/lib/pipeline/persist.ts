/**
 * Pipeline persistence — saves the generated note and metadata to the
 * visit record. Shared by both /api/generate and /api/adjust.
 *
 * Handles:
 *   - Column update (encounter_note + status)
 *   - Metadata merge (template_id, section_contents, clinical_analysis, etc.)
 *   - Lost-note logging on failure
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { retrySupabaseCall } from "@/lib/supabase/retry";
import { mergeVisitMetadata } from "@/lib/supabase/merge-metadata";
import type { FileFocusCache } from "@/lib/sections/file-focus";
import type { SuggestedIcdCode } from "@/lib/sections/suggest-icd";
import { logger } from "@/lib/logger";

// ── Public types ──────────────────────────────────────────────────

export interface PersistGenerationInput {
  supabase: SupabaseClient;
  visitId: string;
  generatedNote: string;
  templateId: string;
  sectionContents: Record<string, string>;
  metadataPartial?: Record<string, unknown>;
  updatedFileFocusCache?: FileFocusCache;
  clinicalAnalysis?: { suggestedIcdCodes: SuggestedIcdCode[] };
  /** Defaults to "to_review". */
  status?: string;
  /** Log label for error messages (e.g. "generate", "adjust"). */
  label: string;
}

export interface PersistGenerationResult {
  success: boolean;
  error?: unknown;
}

// ── Implementation ────────────────────────────────────────────────

export async function persistGeneration(
  input: PersistGenerationInput,
): Promise<PersistGenerationResult> {
  const {
    supabase,
    visitId,
    generatedNote,
    templateId,
    sectionContents,
    metadataPartial: extraMetadata,
    updatedFileFocusCache,
    clinicalAnalysis,
    status = "to_review",
    label,
  } = input;

  // 1. Column update
  const columnPayload: Record<string, unknown> = {
    encounter_note: generatedNote,
    status,
  };
  const { error: columnError } = await retrySupabaseCall(
    () =>
      supabase
        .from("visits")
        .update(columnPayload)
        .eq("id", visitId) as unknown as Promise<{
        data: null;
        error: unknown;
      }>,
    { label: `${label}-save-columns` },
  );

  // 2. Metadata merge
  const metadataPayload: Record<string, unknown> = {
    template_id: templateId,
    generation_pending: null,
    recording_session: null,
    section_contents: sectionContents,
    ...(updatedFileFocusCache
      ? { file_focus_cache: updatedFileFocusCache }
      : {}),
    ...(clinicalAnalysis ? { clinical_analysis: clinicalAnalysis } : {}),
    ...(extraMetadata ?? {}),
  };

  let metadataError: unknown = null;
  try {
    await mergeVisitMetadata(supabase, visitId, metadataPayload);
  } catch (err) {
    metadataError = err;
  }

  // 3. Error handling with lost-note logging
  const saveError = columnError || metadataError;
  if (saveError) {
    logger.error(`[${label}] Failed to save generated content:`, saveError);
    logger.error(
      `[${label}] LOST NOTE visit=${visitId} note_len=${generatedNote.length}`,
    );
    logger.error(
      `[${label}] LOST NOTE BODY visit=${visitId}:\n${generatedNote}`,
    );
    return { success: false, error: saveError };
  }

  return { success: true };
}
