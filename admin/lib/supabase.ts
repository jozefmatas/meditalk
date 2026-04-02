import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { clientEnv } from "./env/client";
import { serverEnv } from "./env/server";

let _client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      clientEnv.NEXT_PUBLIC_SUPABASE_URL,
      serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    );
  }
  return _client;
}
