import { createClient } from '@supabase/supabase-js';

let _adminClient: ReturnType<typeof createClient> | null = null;

/**
 * Server-only Supabase client using service role key.
 * Bypasses RLS — use ONLY for trusted server-side operations.
 */
export function createAdminClient() {
  if (_adminClient) return _adminClient;

  _adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  return _adminClient;
}
