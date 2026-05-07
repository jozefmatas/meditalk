import { NextResponse } from "next/server";
import { requireAuth } from "./auth";

export type AuthResult = Awaited<ReturnType<typeof requireAuth>>;

/**
 * Wraps a Next.js route handler with authentication + error handling.
 * Eliminates the repeated try/catch boilerplate around requireAuth().
 */
export function withAuth<Args extends unknown[]>(
  handler: (
    auth: AuthResult,
    request: Request,
    ...args: Args
  ) => Promise<Response>,
): (request: Request, ...args: Args) => Promise<Response> {
  return async (request, ...args) => {
    let auth: AuthResult;
    try {
      auth = await requireAuth();
    } catch (err) {
      if (err instanceof Response) return err;
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      return await handler(auth, request, ...args);
    } catch (err) {
      if (err instanceof Response) return err;
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }
  };
}
