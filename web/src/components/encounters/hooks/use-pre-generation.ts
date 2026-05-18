"use client";

import { useCallback } from "react";
import type { RecordingBarRef } from "@/components/encounters/recording-bar";
import type { SupportedLanguage, Encounter } from "@/lib/types";
import { uploadToStorage } from "@/lib/supabase/upload";
import { audioMimeToExt } from "./use-audio-recorder";
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
export interface FinalizedRecording {
  blob: Blob | null;
  isRestoredSession: boolean;
  releaseGuards?: () => void;
}

export function usePreGeneration(visitId: string) {
  const prepareSource = useCallback(
    async (params: {
      recordingBarRef: React.RefObject<RecordingBarRef | null>;
      language: SupportedLanguage;
      visit: Encounter | null;
      /** Pre-finalized recording — when provided, skips finalization
       *  so the caller can switch to processing UI in between. */
      finalized?: FinalizedRecording | null;
    }): Promise<PreGenerationResult> => {
      const { recordingBarRef, visit, finalized: preFinalized } = params;

      let releaseGuards: (() => void) | undefined;
      let blobToProcess: Blob | null;

      if (preFinalized !== undefined) {
        // Caller already finalized the recording
        blobToProcess = preFinalized?.blob ?? null;
        releaseGuards = preFinalized?.releaseGuards;
      } else {
        // Legacy path: finalize inline
        releaseGuards = recordingBarRef.current?.releaseGuards;
        const result = await recordingBarRef.current?.finalize();
        blobToProcess = result?.blob ?? null;
      }

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

      // Resolve audio recovery path — server decides whether to use it
      // (server-side waitForTranscript polls for in-flight transcripts)
      const meta = visit?.metadata;
      const pendingMeta = meta?.generation_pending;
      const sessionMeta = meta?.recording_session;

      let audioRecoveryPath: string | undefined;
      if (blobToProcess && uploadedPath) {
        audioRecoveryPath = uploadedPath;
      } else if (blobToProcess && sessionMeta?.audioPath) {
        // Upload failed — fall back to session audio path
        audioRecoveryPath = sessionMeta.audioPath;
      } else if (!blobToProcess) {
        // No new recording — use existing audio path from metadata
        audioRecoveryPath =
          pendingMeta?.audioPath || sessionMeta?.audioPath || undefined;
      }

      return {
        transcriptText: null,
        audioRecoveryPath,
        releaseGuards,
      };
    },
    [visitId],
  );

  return { prepareSource };
}
