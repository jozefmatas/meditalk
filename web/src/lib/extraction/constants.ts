/**
 * Shared constants for the file extraction layer.
 *
 * Used by both server-side (generate/extract routes) and client-side
 * (use-encounter-data, use-generation-polling) to avoid magic numbers
 * and keep thresholds in sync.
 */

/** How long before a stuck extraction (status "extracting") is considered dead. */
export const EXTRACTION_STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/** How long before a stuck generation (status "processing") is considered dead. */
export const GENERATION_STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/** Max time to wait for in-progress extractions before generating anyway. */
export const EXTRACTION_WAIT_TIMEOUT_MS = 60_000; // 60 seconds

/** How often to poll for extraction completion inside the generate route. */
export const EXTRACTION_POLL_INTERVAL_MS = 500;

/** RPC retry delays for persisting extracted text (losing OCR output is expensive). */
export const EXTRACTION_RPC_RETRY_DELAYS = [500, 1000, 2000] as const;
