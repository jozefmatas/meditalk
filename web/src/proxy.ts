import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Create next-intl middleware handler
const handleI18nRouting = createIntlMiddleware(routing);

// App-only route segments (after stripping locale prefix)
const APP_ROUTE_PREFIXES = ["/encounters", "/settings", "/templates"];

function isAppRoute(pathname: string): boolean {
  // Strip locale prefix if present (e.g. /cs/encounters → /encounters)
  const withoutLocale = pathname.replace(/^\/(sk|cs|en)/, "") || "/";
  return APP_ROUTE_PREFIXES.some(
    (prefix) =>
      withoutLocale === prefix || withoutLocale.startsWith(`${prefix}/`),
  );
}

export async function proxy(request: NextRequest) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // ── Domain detection ──
  const host = request.headers.get("host") || "";
  const isAppDomain = host.startsWith("app.");
  const isProductionDomain =
    host.endsWith(".meditalk.ai") || host === "meditalk.ai";
  const isMarketingDomain = isProductionDomain && !isAppDomain;

  // STEP 1: Check for language query parameter from marketing site
  const langParam =
    url.searchParams.get("lang") || url.searchParams.get("locale");

  if (langParam && routing.locales.includes(langParam as "sk" | "cs" | "en")) {
    url.searchParams.delete("lang");
    url.searchParams.delete("locale");

    const search = url.search;
    const response = NextResponse.redirect(
      new URL(`${pathname}${search}`, request.url),
    );

    response.cookies.set("NEXT_LOCALE", langParam, {
      maxAge: 31536000,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      // Share cookie across subdomains when on production domain
      ...(isProductionDomain ? { domain: ".meditalk.ai" } : {}),
    });

    return response;
  }

  // STEP 2: Skip i18n for non-localized routes (auth callbacks, API routes)
  const isAuthCallback = pathname.startsWith("/auth/");
  const isApiRoute = pathname.startsWith("/api/");

  if (isAuthCallback || isApiRoute) {
    return NextResponse.next();
  }

  // STEP 3: Marketing domain — redirect app routes to app subdomain
  if (isMarketingDomain && isAppRoute(pathname)) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || `https://app.${host}`;
    return NextResponse.redirect(new URL(`${pathname}${url.search}`, appUrl));
  }

  // STEP 3b: Marketing domain — rewrite root path to /landing
  // (Next.js can't have two page.tsx at the same path, so we use an internal route)
  if (isMarketingDomain) {
    const withoutLocale = pathname.replace(/^\/(sk|cs|en)/, "") || "/";
    if (withoutLocale === "/") {
      // Authenticated users → redirect to app domain instead of landing
      const hasAuthCookie = request.cookies
        .getAll()
        .some(
          (c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token"),
        );
      if (hasAuthCookie) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || `https://app.${host}`;
        return NextResponse.redirect(new URL("/", appUrl));
      }

      const rewriteUrl = request.nextUrl.clone();
      const localeMatch = pathname.match(/^\/(sk|cs|en)/);
      const locale = localeMatch
        ? localeMatch[1]
        : routing.defaultLocale || "sk";
      rewriteUrl.pathname = `/${locale}/landing`;
      return NextResponse.rewrite(rewriteUrl);
    }
  }

  // STEP 4: Handle i18n routing
  const i18nResponse = handleI18nRouting(request);

  // If i18n middleware wants to redirect (e.g. locale detection/switch), return immediately.
  // The redirected request will re-enter the middleware for auth checks.
  if (i18nResponse.headers.get("location")) {
    return i18nResponse;
  }

  // STEP 5: Marketing domain — skip auth, serve public pages
  if (isMarketingDomain) {
    return i18nResponse;
  }

  // STEP 6: Handle Supabase auth — refresh session, protect routes
  // (app domain, localhost, preview deploys)
  let supabaseResponse = i18nResponse;

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value),
            );
            supabaseResponse = NextResponse.next({
              request,
            });
            // Preserve i18n rewrite header so next-intl locale routing still works
            const rewrite = i18nResponse.headers.get("x-middleware-rewrite");
            if (rewrite) {
              supabaseResponse.headers.set("x-middleware-rewrite", rewrite);
            }
            // Carry over cookies set by the i18n middleware (e.g. NEXT_LOCALE)
            i18nResponse.cookies.getAll().forEach(({ name, value }) => {
              supabaseResponse.cookies.set(name, value);
            });
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, {
                ...options,
                // Share auth cookies across subdomains when on production domain
                ...(isProductionDomain ? { domain: ".meditalk.ai" } : {}),
              }),
            );
          },
        },
      },
    );

    // Refresh session if expired — required for Server Components
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const isLoginPage = pathname.includes("/login");

    // Unauthenticated user on a protected page → redirect to login
    if (!user && !isLoginPage) {
      const localeMatch = pathname.match(/^\/(sk|cs|en)(\/|$)/);
      const localePrefix = localeMatch ? `/${localeMatch[1]}` : "";
      const loginUrl = new URL(`${localePrefix}/login`, request.url);
      return NextResponse.redirect(loginUrl);
    }

    // Authenticated user on login page → redirect to home
    if (user && isLoginPage) {
      const localeMatch = pathname.match(/^\/(sk|cs|en)(\/|$)/);
      const localePrefix = localeMatch ? `/${localeMatch[1]}` : "";
      return NextResponse.redirect(new URL(`${localePrefix}/`, request.url));
    }
  } catch (e) {
    // If Supabase auth fails (network error, etc.), let the request through
    // so the page can handle auth state on its own
    console.error("[middleware] Supabase auth error:", e);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
