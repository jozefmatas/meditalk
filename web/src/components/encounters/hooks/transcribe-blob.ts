/**
 * Batch transcription helper for the encounter generation flow.
 *
 * POSTs the recorded audio blob to /api/batch-transcribe (ElevenLabs
 * Scribe v2 batch API) and returns the transcript text. The native
 * AudioRecord foreground service keeps the microphone alive across
 * backgrounding, so the blob is always the full recording.
 */
import { logger } from "@/lib/logger";

export interface TranscribeBlobDeps {
  /** fetch implementation — injectable so unit tests don't need global mocks. */
  fetch: typeof fetch;
}

/**
 * POST a recorded audio blob to /api/batch-transcribe and return the
 * transcript text. Returns `null` on any failure so callers can fall
 * back without try/catch noise.
 */
export async function transcribeBlob(
  blob: Blob,
  language: string,
  visitId: string,
  deps: TranscribeBlobDeps = { fetch: globalThis.fetch.bind(globalThis) },
): Promise<string | null> {
  try {
    const form = new FormData();
    form.append("audio", blob, "recording.webm");
    form.append("language", language);
    form.append("visitId", visitId);

    const res = await deps.fetch("/api/batch-transcribe", {
      method: "POST",
      body: form,
    });

    if (!res.ok) {
      logger.warn(
        `[transcribe-blob] Batch transcription failed: ${res.status}`,
      );
      return null;
    }

    const data = (await res.json()) as { text?: string };
    const text = data?.text;
    if (!text) {
      logger.warn("[transcribe-blob] Batch transcription returned empty text");
      return null;
    }
    logger.debug(
      `[transcribe-blob] Batch transcription succeeded: ${text.length} chars`,
    );
    return text;
  } catch (err) {
    logger.warn("[transcribe-blob] Batch transcription error:", err);
    return null;
  }
}
