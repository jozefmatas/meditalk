import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import createIntlMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

// Create next-intl middleware handler
const handleI18nRouting = createIntlMiddleware(routing)

export async function proxy(request: NextRequest) {
  const url = new URL(request.url)
  const pathname = url.pathname

  // STEP 1: Check for language query parameter from Framer marketing site
  const langParam = url.searchParams.get('lang') || url.searchParams.get('locale')

  if (langParam && routing.locales.includes(langParam as 'sk' | 'cs' | 'en')) {
    url.searchParams.delete('lang')
    url.searchParams.delete('locale')

    const search = url.search
    const response = NextResponse.redirect(new URL(`${pathname}${search}`, request.url))

    response.cookies.set('NEXT_LOCALE', langParam, {
      maxAge: 31536000,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    })

    return response
  }

  // STEP 2: Skip i18n for non-localized routes (auth callbacks, API routes)
  const isAuthCallback = pathname.startsWith('/auth/')
  const isApiRoute = pathname.startsWith('/api/')

  if (isAuthCallback || isApiRoute) {
    return NextResponse.next()
  }

  // STEP 3: Handle i18n routing
  const i18nResponse = handleI18nRouting(request)

  // If i18n middleware wants to redirect (e.g. locale detection/switch), return immediately.
  // The redirected request will re-enter the middleware for auth checks.
  if (i18nResponse.headers.get('location')) {
    return i18nResponse
  }

  // STEP 4: Handle Supabase auth — refresh session, protect routes
  let supabaseResponse = i18nResponse

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
            supabaseResponse = NextResponse.next({
              request,
            })
            // Preserve i18n rewrite header so next-intl locale routing still works
            const rewrite = i18nResponse.headers.get('x-middleware-rewrite')
            if (rewrite) {
              supabaseResponse.headers.set('x-middleware-rewrite', rewrite)
            }
            // Carry over cookies set by the i18n middleware (e.g. NEXT_LOCALE)
            i18nResponse.cookies.getAll().forEach(({ name, value }) => {
              supabaseResponse.cookies.set(name, value)
            })
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    // Refresh session if expired — required for Server Components
    const { data: { user } } = await supabase.auth.getUser()

    const isLoginPage = pathname.includes('/login')

    // Unauthenticated user on a protected page → redirect to login
    if (!user && !isLoginPage) {
      const localeMatch = pathname.match(/^\/(sk|cs|en)(\/|$)/)
      const localePrefix = localeMatch ? `/${localeMatch[1]}` : ''
      const loginUrl = new URL(`${localePrefix}/login`, request.url)
      return NextResponse.redirect(loginUrl)
    }

    // Authenticated user on login page → redirect to home
    if (user && isLoginPage) {
      const localeMatch = pathname.match(/^\/(sk|cs|en)(\/|$)/)
      const localePrefix = localeMatch ? `/${localeMatch[1]}` : ''
      return NextResponse.redirect(new URL(`${localePrefix}/`, request.url))
    }
  } catch (e) {
    // If Supabase auth fails (network error, etc.), let the request through
    // so the page can handle auth state on its own
    console.error('[middleware] Supabase auth error:', e)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
