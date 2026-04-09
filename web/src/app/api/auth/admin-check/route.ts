import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { isAdminEmail } from "@/lib/admin";

/**
 * GET /api/auth/admin-check
 * Returns whether the current user is an admin.
 * Decoupled from impersonation — safe to keep when impersonation is removed.
 */
export async function GET() {
  try {
    const { realUserEmail } = await requireAuth();
    return NextResponse.json({ isAdmin: isAdminEmail(realUserEmail) });
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ isAdmin: false });
  }
}
