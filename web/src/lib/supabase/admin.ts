import { createClient } from "@supabase/supabase-js";
import { clientEnv } from "@/lib/env/client";
import { serverEnv } from "@/lib/env/server";
import { logger } from "@/lib/logger";

let _adminClient: ReturnType<typeof createClient> | null = null;

/**
 * Server-only Supabase client using service role key.
 * Bypasses RLS — use ONLY for trusted server-side operations.
 * Returns null if SUPABASE_SERVICE_ROLE_KEY is not set.
 */
export function createAdminClient(): ReturnType<typeof createClient> | null {
  if (_adminClient) return _adminClient;

  const serviceRoleKey = serverEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    logger.warn(
      "[admin] SUPABASE_SERVICE_ROLE_KEY not set — admin operations will be skipped",
    );
    return null;
  }

  _adminClient = createClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  return _adminClient;
}
