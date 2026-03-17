import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const host = request.headers.get("host") || "";
  const isProductionDomain =
    host.endsWith(".meditalk.ai") || host === "meditalk.ai";

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, {
                  ...options,
                  // Share auth cookies across subdomains on production
                  ...(isProductionDomain ? { domain: ".meditalk.ai" } : {}),
                }),
              );
            } catch {
              // Ignore - cookie setting may fail in some contexts
            }
          },
        },
      },
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Redirect to app domain if configured (handles marketing → app flow)
      const redirectOrigin = process.env.NEXT_PUBLIC_APP_URL || origin;
      return NextResponse.redirect(`${redirectOrigin}${next}`);
    }
  }

  // Auth error — redirect to login with error indicator
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
