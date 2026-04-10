import type { SupabaseClient } from "@supabase/supabase-js";
import { retrySupabaseCall } from "./retry";
import { logger } from "@/lib/logger";

/**
 * Atomically merge partial metadata into a visit's metadata JSONB.
 *
 * Uses the `merge_visit_metadata` PostgreSQL RPC which does a shallow merge
 * via the `||` operator in a single atomic operation — no read-modify-write
 * race condition.
 *
 * Keys set to `null` in `partial` are deleted from the result (useful for
 * stripping transient keys like `generation_pending` and `recording_session`
 * after generation completes).
 *
 * Wraps the call in `retrySupabaseCall` to handle transient socket failures
 * (Cloudflare 100s idle timeout on Supabase connections).
 *
 * Falls back to a non-atomic read-modify-write if the RPC is not yet deployed
 * (PGRST202 = function not found in schema cache).
 */
export async function mergeVisitMetadata(
  supabase: SupabaseClient,
  visitId: string,
  partial: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await retrySupabaseCall(
    async () =>
      await supabase.rpc("merge_visit_metadata", {
        p_visit_id: visitId,
        p_partial: partial,
      }),
    { label: "merge-metadata" },
  );

  if (result.error) {
    // PGRST202 = function not found — the migration hasn't been applied yet.
    // Fall back to non-atomic read-modify-write so the app keeps working.
    const errObj = result.error as { code?: string };
    if (errObj.code === "PGRST202") {
      logger.warn(
        `[merge-metadata] RPC not found, falling back to non-atomic merge for visit ${visitId}`,
      );
      return fallbackMerge(supabase, visitId, partial);
    }

    logger.error(`[merge-metadata] Failed for visit ${visitId}:`, result.error);
    throw result.error instanceof Error
      ? result.error
      : new Error(String(result.error));
  }

  return (result.data ?? {}) as Record<string, unknown>;
}

/**
 * Non-atomic fallback: read current metadata, shallow merge in JS, write back.
 * Used only when the `merge_visit_metadata` RPC is not yet deployed.
 */
async function fallbackMerge(
  supabase: SupabaseClient,
  visitId: string,
  partial: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data: current, error: readError } = await supabase
    .from("visits")
    .select("metadata")
    .eq("id", visitId)
    .single();

  if (readError) {
    throw readError instanceof Error ? readError : new Error(String(readError));
  }

  const currentMeta = (current?.metadata ?? {}) as Record<string, unknown>;
  const merged = { ...currentMeta, ...partial };

  // Delete keys explicitly set to null (same semantics as the RPC)
  for (const [key, value] of Object.entries(partial)) {
    if (value === null) {
      delete merged[key];
    }
  }

  const { error: writeError } = await supabase
    .from("visits")
    .update({ metadata: merged })
    .eq("id", visitId);

  if (writeError) {
    throw writeError instanceof Error
      ? writeError
      : new Error(String(writeError));
  }

  return merged;
}
