import { logger } from "@/lib/logger";
import { isTransientNetworkError } from "@/lib/api/is-transient-error";

/**
 * Retry a Supabase call on transient fetch-level failures.
 *
 * Motivation: long-running API routes (e.g. `/api/generate`) create a
 * Supabase server client at auth time, then go silent for 100+ seconds
 * while talking to Anthropic (fact extraction + Opus generation). During
 * that window, the pooled HTTPS connection held by undici sits idle and
 * is silently closed by Cloudflare (which fronts Supabase) after ~100s.
 * When we finally try to persist the generated note, undici reuses the
 * stale socket and throws `TypeError: fetch failed` — even though the
 * generation itself succeeded, the save is lost and the user has to
 * regenerate.
 *
 * This helper retries the operation up to `maxAttempts` times with a
 * short exponential backoff. On retry, undici discards the dead socket
 * and opens a fresh connection, which succeeds.
 *
 * Only transient transport-level errors are retried — see
 * `isTransientNetworkError` in `@/lib/api/is-transient-error` for the
 * full pattern list.
 *
 * Supabase row-level / constraint errors returned in the `error` field
 * are NOT retried — those are application-level failures and would
 * reproduce on retry.
 */
export async function retrySupabaseCall<T>(
  operation: () => Promise<{ data: T; error: unknown } | { error: unknown }>,
  opts: {
    label: string;
    maxAttempts?: number;
    baseDelayMs?: number;
  },
): Promise<{ data?: T; error: unknown }> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 200;

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = (await operation()) as {
        data?: T;
        error: unknown;
      };
      // Supabase returned a structured error — not a transport failure.
      // Do NOT retry: constraint violations / RLS / bad payload would
      // reproduce and just waste time.
      if (result.error) {
        return result;
      }
      if (attempt > 1) {
        logger.info(
          `[${opts.label}] Supabase call succeeded on attempt ${attempt}`,
        );
      }
      return result;
    } catch (err) {
      lastError = err;
      if (!isTransientFetchError(err) || attempt === maxAttempts) {
        // Non-transient or out of attempts — surface to caller.
        return { error: err };
      }
      const delay = baseDelayMs * 2 ** (attempt - 1);
      logger.warn(
        `[${opts.label}] Transient Supabase fetch error on attempt ${attempt}/${maxAttempts}, retrying in ${delay}ms: ${errMessage(err)}`,
      );
      await sleep(delay);
    }
  }

  return { error: lastError };
}

/**
 * Identify transport-level fetch failures that are safe to retry.
 * Delegates to the unified `isTransientNetworkError`.
 */
export function isTransientFetchError(err: unknown): boolean {
  return isTransientNetworkError(err);
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
