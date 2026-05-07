/**
 * Persist a recording snapshot: upload blob to storage + save session metadata.
 *
 * Extracted from `recording-bar.tsx` so the business logic (upload → metadata
 * PATCH → transcribe → PATCH transcript) is independently testable without
 * rendering a React component.
 */
import { uploadToStorage } from "@/lib/supabase/upload";
import { patchEncounter } from "@/lib/encounters/api";
import { audioMimeToExt } from "@/lib/audio/mime-utils";
import {
  transcribeBlob,
  transcribeFromPath,
} from "@/components/encounters/hooks/transcribe-blob";
import { logger } from "@/lib/logger";

interface PersistSnapshotParams {
  blob: Blob;
  visitId: string;
  durationSeconds: number;
  /** Language for transcription. If omitted, transcription is skipped. */
  language?: string;
  /** True when running on native (Capacitor). Uses storage-path transcription. */
  isNative?: boolean;
}

interface PersistSnapshotResult {
  storagePath: string;
}

/**
 * Upload the recording blob, persist session metadata, and optionally
 * fire-and-forget transcription that saves to metadata.transcript.
 */
export async function persistRecordingSnapshot({
  blob,
  visitId,
  durationSeconds,
  language,
  isNative = false,
}: PersistSnapshotParams): Promise<PersistSnapshotResult> {
  const ext = audioMimeToExt(blob.type);
  const { path } = await uploadToStorage(blob, `recording${ext}`, {
    encounterId: visitId,
  });

  await patchEncounter(visitId, {
    metadata: {
      recording_session: {
        state: "paused",
        durationAtPause: durationSeconds,
        audioPath: path,
      },
    },
  });

  logger.debug(`[recording] Blob uploaded at pause: ${path}`);

  // Fire-and-forget transcription
  if (language) {
    const transcribePromise = isNative
      ? transcribeFromPath(path, language, visitId)
      : transcribeBlob(blob, language, visitId);

    transcribePromise
      .then((text) => {
        if (!text) return;
        patchEncounter(visitId, { metadata: { transcript: text } });
        logger.debug(
          `[recording] Pause-time transcription saved: ${text.length} chars`,
        );
      })
      .catch((err) => {
        logger.warn("[recording] Transcription failed:", err);
      });
  }

  return { storagePath: path };
}
