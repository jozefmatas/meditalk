"use client";

import { useCallback } from "react";
import type { RecordingBarRef } from "@/components/encounters/recording-bar";
import type { SupportedLanguage } from "@/lib/types";
import type { Encounter } from "@/lib/types";
import { transcribeBlob, transcribeFromPath } from "./transcribe-blob";
import { uploadToStorage } from "@/lib/supabase/upload";
import { audioMimeToExt } from "./use-audio-recorder";
import { getTranscript } from "@/lib/encounters/sources";
import { toast } from "sonner";
import { logger } from "@/lib/logger";

export interface PreGenerationResult {
  /** Client-side transcript (null if transcription failed). */
  transcriptText: string | null;
  /** Path to uploaded audio blob for server-side recovery. */
  audioRecoveryPath: string | undefined;
  /** Call to tear down foreground service after transcription. */
  releaseGuards?: () => void;
}

/**
 * Pre-generation hook — handles recording finalization, blob upload,
 * transcription, and audio recovery path resolution.
 *
 * Extracted from handleGenerate / handleAdjustGenerate in the god hook.
 */
export function usePreGeneration(visitId: string) {
  const prepareSource = useCallback(
    async (params: {
      recordingBarRef: React.RefObject<RecordingBarRef | null>;
      language: SupportedLanguage;
      visit: Encounter | null;
    }): Promise<PreGenerationResult> => {
      const { recordingBarRef, language, visit } = params;

      // Capture releaseGuards before unmount nulls the ref
      const releaseGuards = recordingBarRef.current?.releaseGuards;

      // Finalize recording
      const finalized = await recordingBarRef.current?.finalize();
      const blobToProcess = finalized?.blob ?? null;
      const isRestoredSession = finalized?.isRestoredSession ?? false;

      logger.debug(
        `[pre-gen] Finalized — blob: ${blobToProcess?.size || 0} bytes`,
      );

      // Upload blob to Supabase storage
      let uploadedPath: string | null = null;
      if (blobToProcess) {
        try {
          const ext = audioMimeToExt(blobToProcess.type);
          const fileName = `recovery${ext}`;
          const { path } = await uploadToStorage(
            new File([blobToProcess], fileName, {
              type: blobToProcess.type,
            }),
            fileName,
            { encounterId: visitId },
          );
          uploadedPath = path;
          logger.debug(`[pre-gen] Blob uploaded: ${path}`);
        } catch (err) {
          logger.warn("[pre-gen] Blob upload failed:", err);
        }
      }

      // Transcribe: prefer storage-path (no body limit) when uploaded
      let finalTranscript: string | null;
      if (uploadedPath) {
        finalTranscript = await transcribeFromPath(
          uploadedPath,
          language,
          visitId,
        );
        // Fallback to direct blob if storage-path transcription failed
        if (!finalTranscript && blobToProcess) {
          logger.warn(
            "[pre-gen] Storage-path transcription failed, trying direct blob",
          );
          finalTranscript = await transcribeBlob(
            blobToProcess,
            language,
            visitId,
          );
        }
      } else if (blobToProcess) {
        finalTranscript = await transcribeBlob(
          blobToProcess,
          language,
          visitId,
        );
      } else {
        finalTranscript = getTranscript(
          visit?.metadata as Record<string, unknown>,
        );
      }

      // Warn user on transcription failure
      if (blobToProcess && !finalTranscript) {
        logger.error(
          `[pre-gen] Client transcription failed for ${blobToProcess.size} byte blob (uploaded=${!!uploadedPath})`,
        );
        if (uploadedPath) {
          toast.info(
            "Transcription is taking longer than usual. The server will process your recording automatically.",
            { duration: 8_000 },
          );
        } else {
          toast.warning(
            "Recording transcription failed. The note will be generated from uploaded files only.",
            { duration: 10_000 },
          );
        }
      }

      // Resolve audio recovery path for server-side
      const meta = (visit?.metadata ?? {}) as Record<string, unknown>;
      const pendingMeta = meta?.generation_pending as
        | { audioPath?: string }
        | undefined;
      const sessionMeta = meta?.recording_session as
        | { audioPath?: string }
        | undefined;

      let audioRecoveryPath: string | undefined;
      if (!blobToProcess) {
        audioRecoveryPath =
          pendingMeta?.audioPath || sessionMeta?.audioPath || undefined;
      } else if (!finalTranscript && uploadedPath) {
        audioRecoveryPath = uploadedPath;
      } else if (!finalTranscript && !uploadedPath && sessionMeta?.audioPath) {
        audioRecoveryPath = sessionMeta.audioPath;
      } else if (isRestoredSession && sessionMeta?.audioPath) {
        audioRecoveryPath = sessionMeta.audioPath;
      }

      return {
        transcriptText: finalTranscript,
        audioRecoveryPath,
        releaseGuards,
      };
    },
    [visitId],
  );

  return { prepareSource };
}
