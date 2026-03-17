import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail, IMPERSONATE_COOKIE } from "@/lib/admin";

async function requireAdmin() {
  const { realUserEmail } = await requireAuth();

  if (!isAdminEmail(realUserEmail)) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  return { email: realUserEmail };
}

/**
 * GET /api/admin/impersonate
 * List all users. Admin only.
 */
export async function GET() {
  try {
    await requireAdmin();

    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 100 });

    if (error) {
      return NextResponse.json(
        { error: "Failed to list users" },
        { status: 500 },
      );
    }

    const users = data.users.map((u) => ({
      id: u.id,
      email: u.email,
      name:
        u.user_metadata?.full_name ||
        u.user_metadata?.name ||
        u.email?.split("@")[0],
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
    }));

    return NextResponse.json({ users });
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/admin/impersonate
 * Body: { userId: string }
 * Sets the impersonation cookie.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin();

    const { userId } = await request.json();
    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }

    // Verify target user exists
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data.user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const cookieStore = await cookies();
    cookieStore.set(IMPERSONATE_COOKIE, userId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 4, // 4 hours
    });

    return NextResponse.json({
      success: true,
      impersonating: {
        id: data.user.id,
        email: data.user.email,
        name:
          data.user.user_metadata?.full_name || data.user.user_metadata?.name,
      },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/admin/impersonate
 * Clears the impersonation cookie.
 */
export async function DELETE() {
  try {
    const cookieStore = await cookies();
    cookieStore.set(IMPERSONATE_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
