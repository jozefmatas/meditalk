import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail, IMPERSONATE_COOKIE } from "@/lib/admin";

/**
 * GET /api/admin/impersonate/status
 * Returns current impersonation state for the frontend.
 */
export async function GET() {
  try {
    const { realUserEmail } = await requireAuth();

    if (!isAdminEmail(realUserEmail)) {
      return NextResponse.json({ isAdmin: false, isImpersonating: false });
    }

    const cookieStore = await cookies();
    const impersonateUserId = cookieStore.get(IMPERSONATE_COOKIE)?.value;

    if (!impersonateUserId) {
      return NextResponse.json({ isAdmin: true, isImpersonating: false });
    }

    const admin = createAdminClient();
    const { data } = await admin.auth.admin.getUserById(impersonateUserId);

    return NextResponse.json({
      isAdmin: true,
      isImpersonating: true,
      target: data?.user
        ? {
            id: data.user.id,
            email: data.user.email,
            name:
              data.user.user_metadata?.full_name ||
              data.user.user_metadata?.name,
          }
        : { id: impersonateUserId },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ isAdmin: false, isImpersonating: false });
  }
}
