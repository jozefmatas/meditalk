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

/**
 * Transcribe audio from a Supabase Storage path. The server downloads the
 * file from storage and transcribes via ElevenLabs — the audio never passes
 * through Vercel's body size limit.
 *
 * Preferred path for full recordings (which can be 5-50+ MB).
 * Includes a single retry for transient errors.
 */
export async function transcribeFromPath(
  storagePath: string,
  language: string,
  visitId: string,
  deps: TranscribeBlobDeps = { fetch: globalThis.fetch.bind(globalThis) },
): Promise<string | null> {
  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const res = await deps.fetch("/api/batch-transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath, language, visitId }),
      });

      if (!res.ok) {
        if (isTransient(null, res.status) && attempt === 0) {
          logger.warn(
            `[transcribe-path] Transient error ${res.status}, retrying in ${RETRY_DELAY_MS}ms`,
          );
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        logger.warn(
          `[transcribe-path] Transcription from storage failed: ${res.status}`,
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
      if (isTransient(err) && attempt === 0) {
        logger.warn(
          `[transcribe-path] Network error, retrying in ${RETRY_DELAY_MS}ms`,
        );
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      logger.warn("[transcribe-path] Transcription error:", err);
      return null;
    }
  }
  return null;
}
