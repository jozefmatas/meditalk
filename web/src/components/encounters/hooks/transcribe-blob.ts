/**
 * Blob-first transcription helpers for the encounter generation flow.
 *
 * We always prefer to batch-transcribe the recorded audio blob over the
 * Scribe real-time streaming transcript, because the real-time WebSocket
 * is fragile on Android screen lock (the socket dies and VAD commits
 * whatever partial utterance it has as final) and can silently truncate
 * long recordings. The native AudioRecord foreground service keeps the
 * microphone alive across backgrounding, so the blob is always the full
 * recording. Using the blob as source of truth means we never lose audio
 * to WebSocket lifecycle bugs.
 *
 * The streaming transcript is only used as a fallback when we have no
 * blob at all, or when batch transcription fails for a recoverable
 * reason (network hiccup, server 5xx). See `resolveTranscript` for the
 * full decision logic.
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

export interface ResolveTranscriptInput {
  /** Recorded audio blob from the recording bar (may be null). */
  blob: Blob | null;
  /** Real-time transcript from Scribe (may be null). Used only as fallback. */
  streamingCandidate: string | null;
  /** Language for batch transcription. */
  language: string;
  /** Visit id for server-side attribution. */
  visitId: string;
}

/**
 * Deterministic "which transcript should we send to /api/generate?"
 * decision function. Called by `handleGenerate` and `handleAdjustGenerate`
 * in `use-encounter-generation.ts`.
 *
 * Decision table:
 * | blob present? | batch succeeds? | streaming present? | result         |
 * |---------------|-----------------|--------------------|----------------|
 * | yes           | yes             | —                  | batch result   |
 * | yes           | no              | yes                | streaming      |
 * | yes           | no              | no                 | null           |
 * | no            | —               | yes                | streaming      |
 * | no            | —               | no                 | null           |
 *
 * This encodes the "blob-first, streaming-as-fallback" policy — the
 * streaming transcript is never the source of truth when a full blob
 * is available, because we cannot trust that it covers the entire
 * recording.
 */
export async function resolveTranscript(
  input: ResolveTranscriptInput,
  deps: TranscribeBlobDeps = { fetch: globalThis.fetch.bind(globalThis) },
): Promise<string | null> {
  const { blob, streamingCandidate, language, visitId } = input;

  if (blob && blob.size > 0) {
    logger.debug(
      `[resolve-transcript] Batch-transcribing blob (${blob.size} bytes) as source of truth`,
    );
    const batch = await transcribeBlob(blob, language, visitId, deps);
    if (batch) return batch;

    if (streamingCandidate) {
      logger.warn(
        "[resolve-transcript] Batch transcription failed — falling back to streaming transcript",
      );
      return streamingCandidate;
    }
    return null;
  }

  return streamingCandidate;
}
