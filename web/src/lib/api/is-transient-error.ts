/**
 * Unified transient-error classification.
 *
 * Consolidates three separate implementations into a single source of truth:
 * - `lib/supabase/retry.ts` (network message patterns + error.cause)
 * - `components/encounters/hooks/transcribe-blob.ts` (TypeError + status codes)
 * - `components/encounters/hooks/use-generation-stream.ts` (TypeError + status + regex)
 */

const TRANSIENT_STATUS_CODES = new Set([408, 429, 502, 503, 504]);

/**
 * Returns true if the HTTP status code represents a transient server error
 * worth retrying: 408, 429, 502, 503, 504.
 */
export function isTransientStatusCode(status: number): boolean {
  return TRANSIENT_STATUS_CODES.has(status);
}

/**
 * Returns true if the error represents a transient network-level failure
 * (dead socket, DNS timeout, connection reset, etc.) that is safe to retry.
 *
 * Checks:
 * 1. `TypeError` — thrown by `fetch()` on network failure
 * 2. Known transient message substrings in `err.message` and `err.cause.message`
 */
export function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err instanceof TypeError) return true;

  const msg = (err.message || "").toLowerCase();
  const causeMsg = getCauseMessage(err).toLowerCase();
  const haystack = `${msg} ${causeMsg}`;

  return TRANSIENT_PATTERNS.some((p) => haystack.includes(p));
}

const TRANSIENT_PATTERNS = [
  "fetch failed",
  "econnreset",
  "socket hang up",
  "und_err_socket",
  "other side closed",
  "network",
  "terminated",
  "etimedout",
  "aborted",
  "failed to fetch",
];

function getCauseMessage(err: Error): string {
  if (err.cause instanceof Error) return err.cause.message;
  if (err.cause) return String(err.cause);
  return "";
}
