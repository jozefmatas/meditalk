/**
 * Batch transcription helpers for the encounter generation flow.
 *
 * Two paths:
 * 1. `transcribeBlob` — sends the blob via FormData to /api/batch-transcribe.
 *    Only suitable for small blobs (< 4.5 MB) due to Vercel body limit.
 *    Used for pause-time snapshot transcription.
 *
 * 2. `transcribeFromPath` — sends a Supabase Storage path via JSON to
 *    /api/batch-transcribe. The server downloads from storage and transcribes.
 *    Used for full recordings (bypasses Vercel body limit).
 */
import { logger } from "@/lib/logger";
import {
  isTransientNetworkError,
  isTransientStatusCode,
} from "@/lib/api/is-transient-error";

export interface TranscribeBlobDeps {
  /** fetch implementation — injectable so unit tests don't need global mocks. */
  fetch: typeof fetch;
}

/** Map blob MIME type to file extension for the upload filename. */
function blobMimeToExt(mime: string): string {
  if (mime.includes("mp4")) return ".m4a";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("wav")) return ".wav";
  return ".webm";
}

const MAX_RETRIES = 2; // 3 attempts total
const BASE_DELAY_MS = 3000; // 3s, 6s backoff

function isTransient(err: unknown, status?: number): boolean {
  if (status && isTransientStatusCode(status)) return true;
  return isTransientNetworkError(err);
}

function retryDelay(attempt: number): number {
  return BASE_DELAY_MS * (attempt + 1);
}

/**
 * POST a recorded audio blob to /api/batch-transcribe and return the
 * transcript text. Returns `null` on any failure so callers can fall
 * back without try/catch noise.
 *
 * Retries up to MAX_RETRIES times for transient HTTP errors (408, 429, 5xx)
 * and network failures (TypeError) with exponential backoff.
 */
export async function transcribeBlob(
  blob: Blob,
  language: string,
  visitId: string,
  deps: TranscribeBlobDeps = { fetch: globalThis.fetch.bind(globalThis) },
): Promise<string | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const form = new FormData();
      // Derive filename from blob's actual MIME type — Safari records
      // audio/mp4, not audio/webm. Mismatched filename+content can
      // confuse server-side format detection (e.g. ElevenLabs).
      const ext = blobMimeToExt(blob.type);
      form.append("audio", blob, `recording${ext}`);
      form.append("language", language);
      form.append("visitId", visitId);

      const res = await deps.fetch("/api/batch-transcribe", {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        if (isTransient(null, res.status) && attempt < MAX_RETRIES) {
          const delay = retryDelay(attempt);
          logger.warn(
            `[transcribe-blob] Transient error ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES + 1})`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        logger.warn(
          `[transcribe-blob] Batch transcription failed: ${res.status} (attempt ${attempt + 1}/${MAX_RETRIES + 1})`,
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
      if (isTransient(err) && attempt < MAX_RETRIES) {
        const delay = retryDelay(attempt);
        logger.warn(
          `[transcribe-blob] Network error, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES + 1})`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      logger.warn("[transcribe-blob] Batch transcription error:", err);
      return null;
    }
  }
  return null;
}

/**
 * Transcribe audio from a Supabase Storage path. The server downloads the
 * file from storage and transcribes via ElevenLabs — the audio never passes
 * through Vercel's body size limit.
 *
 * Preferred path for full recordings (which can be 5-50+ MB).
 * Retries up to MAX_RETRIES times for transient errors with exponential backoff.
 */
export async function transcribeFromPath(
  storagePath: string,
  language: string,
  visitId: string,
  deps: TranscribeBlobDeps = { fetch: globalThis.fetch.bind(globalThis) },
): Promise<string | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await deps.fetch("/api/batch-transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath, language, visitId }),
      });

      if (!res.ok) {
        if (isTransient(null, res.status) && attempt < MAX_RETRIES) {
          const delay = retryDelay(attempt);
          logger.warn(
            `[transcribe-path] Transient error ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES + 1})`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        logger.warn(
          `[transcribe-path] Transcription from storage failed: ${res.status} (attempt ${attempt + 1}/${MAX_RETRIES + 1})`,
        );
        return null;
      }

      const data = (await res.json()) as { text?: string };
      const text = data?.text;
      if (!text) {
        logger.warn(
          "[transcribe-path] Transcription from storage returned empty text",
        );
        return null;
      }
      logger.debug(
        `[transcribe-path] Transcription succeeded: ${text.length} chars`,
      );
      return text;
    } catch (err) {
      if (isTransient(err) && attempt < MAX_RETRIES) {
        const delay = retryDelay(attempt);
        logger.warn(
          `[transcribe-path] Network error, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES + 1})`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      logger.warn("[transcribe-path] Transcription error:", err);
      return null;
    }
  }
  return null;
}
