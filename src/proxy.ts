import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import createIntlMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

// Create next-intl middleware handler
const handleI18nRouting = createIntlMiddleware(routing)

export async function proxy(request: NextRequest) {
  const url = new URL(request.url)

  // STEP 1: Check for language query parameter from Framer marketing site
  const langParam = url.searchParams.get('lang') || url.searchParams.get('locale')

  // Validate locale parameter
  if (langParam && routing.locales.includes(langParam as 'sk' | 'cs' | 'en')) {
    // Remove query parameter from URL
    url.searchParams.delete('lang')
    url.searchParams.delete('locale')

    // Redirect to clean URL with locale prefix (if needed based on localePrefix config)
    const pathname = url.pathname
    const search = url.search

    // Create response that will handle the redirect
    const response = NextResponse.redirect(new URL(`${pathname}${search}`, request.url))

    // Set locale cookie for future visits
    response.cookies.set('NEXT_LOCALE', langParam, {
      maxAge: 31536000, // 1 year
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    })

    return response
  }

  // STEP 2: Handle i18n routing
  const i18nResponse = handleI18nRouting(request)

  // STEP 3: Handle Supabase auth
  let supabaseResponse = i18nResponse

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
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session if expired - required for Server Components
  await supabase.auth.getUser()

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
