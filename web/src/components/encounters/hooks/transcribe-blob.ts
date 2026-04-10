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

const TRANSIENT_STATUS_CODES = new Set([408, 429, 502, 503, 504]);
const RETRY_DELAY_MS = 2000;

function isTransient(err: unknown, status?: number): boolean {
  if (err instanceof TypeError) return true; // network failure
  if (status && TRANSIENT_STATUS_CODES.has(status)) return true;
  return false;
}

/**
 * POST a recorded audio blob to /api/batch-transcribe and return the
 * transcript text. Returns `null` on any failure so callers can fall
 * back without try/catch noise.
 *
 * Includes a single retry for transient HTTP errors (408, 429, 5xx)
 * and network failures (TypeError).
 */
export async function transcribeBlob(
  blob: Blob,
  language: string,
  visitId: string,
  deps: TranscribeBlobDeps = { fetch: globalThis.fetch.bind(globalThis) },
): Promise<string | null> {
  for (let attempt = 0; attempt <= 1; attempt++) {
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
        if (isTransient(null, res.status) && attempt === 0) {
          logger.warn(
            `[transcribe-blob] Transient error ${res.status}, retrying in ${RETRY_DELAY_MS}ms`,
          );
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        logger.warn(
          `[transcribe-blob] Batch transcription failed: ${res.status}`,
        );
        return null;
      }

      const data = (await res.json()) as { text?: string };
      const text = data?.text;
      if (!text) {
        logger.warn(
          "[transcribe-blob] Batch transcription returned empty text",
        );
        return null;
      }
      logger.debug(
        `[transcribe-blob] Batch transcription succeeded: ${text.length} chars`,
      );
      return text;
    } catch (err) {
      if (isTransient(err) && attempt === 0) {
        logger.warn(
          `[transcribe-blob] Network error, retrying in ${RETRY_DELAY_MS}ms`,
        );
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      logger.warn("[transcribe-blob] Batch transcription error:", err);
      return null;
    }
  }
  return null;
}
