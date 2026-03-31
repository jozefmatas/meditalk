import { createClient } from "@supabase/supabase-js";

let _adminClient: ReturnType<typeof createClient> | null = null;

/**
 * Server-only Supabase client using service role key.
 * Bypasses RLS — use ONLY for trusted server-side operations.
 * Returns null if SUPABASE_SERVICE_ROLE_KEY is not set.
 */
export function createAdminClient(): ReturnType<typeof createClient> | null {
  if (_adminClient) return _adminClient;

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.warn(
      "[admin] SUPABASE_SERVICE_ROLE_KEY not set — admin operations will be skipped",
    );
    return null;
  }

  _adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
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
