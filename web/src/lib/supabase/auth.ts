import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { clientEnv } from "@/lib/env/client";
import { createAdminClient } from "./admin";
import { isAdminEmail, IMPERSONATE_COOKIE } from "../admin";

/**
 * Verify authentication in API routes.
 * Returns the authenticated user ID and a user-scoped Supabase client.
 * When an admin is impersonating, returns the target userId and the
 * admin client (bypasses RLS) so all data queries work transparently.
 * Throws a Response with 401 if not authenticated.
 */
export async function requireAuth() {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Ignore
          }
        },
      },
    },
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Check for admin impersonation
  const impersonateUserId = cookieStore.get(IMPERSONATE_COOKIE)?.value;

  if (impersonateUserId && isAdminEmail(user.email)) {
    const adminClient = createAdminClient();
    if (!adminClient) {
      throw new Response(
        JSON.stringify({ error: "Admin client unavailable" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    return {
      userId: impersonateUserId,
      supabase: adminClient,
      isImpersonating: true,
      realUserId: user.id,
      realUserEmail: user.email,
    };
  }

  return {
    userId: user.id,
    supabase,
    isImpersonating: false,
    realUserId: user.id,
    realUserEmail: user.email,
  };
}
