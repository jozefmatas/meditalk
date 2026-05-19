import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { logger } from "@/lib/logger";

/** Auth context returned by `requireAuth()`. */
export type AuthInfo = Awaited<ReturnType<typeof requireAuth>>;

/** What the wrapped handler receives. */
export interface WithAuthContext<P> {
  request: NextRequest;
  auth: AuthInfo;
  params: P;
}

/** Next.js dynamic-route second argument. Params are async in Next.js 15+. */
interface RouteContext<P> {
  params: Promise<P>;
}

interface WithAuthOptions {
  /** Tag prepended to logger.error output when the handler throws an Error. */
  logPrefix?: string;
}

/**
 * Wrap an API route handler with shared auth + error handling.
 *
 * - Calls `requireAuth()` and passes the result as `ctx.auth`.
 * - Awaits route params (Next.js 15 async params) and passes them as `ctx.params`.
 * - If `requireAuth()` throws a `Response` (401), returns that Response.
 * - If the handler throws a `Response` (e.g. 404 / 400 with a custom body),
 *   returns it as-is — handlers can `throw new Response(...)` for early exits.
 * - Any other thrown error is logged and returns a generic 500.
 *
 * Use it like:
 *
 *   export const GET = withAuth(async ({ request, auth }) => {
 *     // ... handler logic
 *     return NextResponse.json({...});
 *   });
 *
 * For dynamic routes:
 *
 *   export const GET = withAuth<{ encounterId: string }>(
 *     async ({ params, auth }) => { ... }
 *   );
 */
export function withAuth<P = Record<string, never>>(
  handler: (ctx: WithAuthContext<P>) => Promise<Response>,
  options: WithAuthOptions = {},
): (request: NextRequest, routeCtx?: RouteContext<P>) => Promise<Response> {
  return async (request, routeCtx) => {
    try {
      const auth = await requireAuth();
      const params = routeCtx?.params ? await routeCtx.params : ({} as P);
      return await handler({ request, auth, params });
    } catch (err) {
      if (err instanceof Response) return err;
      const tag = options.logPrefix ? `[${options.logPrefix}]` : "[api]";
      logger.error(`${tag} unhandled error:`, err);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }
  };
}
