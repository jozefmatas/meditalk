/**
 * Shared constants for the file extraction layer.
 *
 * Used by both server-side (generate/extract routes) and client-side
 * (use-encounter-data, use-generation-polling) to avoid magic numbers
 * and keep thresholds in sync.
 */

/** How long before a stuck extraction (status "extracting") is considered dead. */
export const EXTRACTION_STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/** How long before a stuck generation (status "processing") is considered dead.
 *  Typical generation takes 60-120s; 3 min gives a safe 1.5-3x margin. */
export const GENERATION_STALE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes

/** Max time to wait for in-progress extractions before falling back to
 *  inline extraction. Covers the slow tail of OCR (typical: 15-50s; slow
 *  PDFs can push 90-120s). We'd rather wait than drop discharge-letter
 *  content from the prompt. */
export const EXTRACTION_WAIT_TIMEOUT_MS = 180_000; // 3 minutes

/** How often to poll for extraction completion inside the generate route. */
export const EXTRACTION_POLL_INTERVAL_MS = 500;

/** RPC retry delays for persisting extracted text (losing OCR output is expensive). */
export const EXTRACTION_RPC_RETRY_DELAYS = [500, 1000, 2000] as const;

/** Max time to wait for an in-flight pause-time transcript before falling
 *  back to inline audio recovery. Typical batch-transcribe takes 5-15s. */
export const TRANSCRIPT_WAIT_TIMEOUT_MS = 30_000; // 30 seconds

/** How often to poll for transcript completion inside resolve-source. */
export const TRANSCRIPT_POLL_INTERVAL_MS = 1_000; // 1 second
