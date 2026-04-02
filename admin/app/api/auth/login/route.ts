import { NextRequest, NextResponse } from "next/server";
import { serverEnv } from "@/lib/env/server";

export async function POST(request: NextRequest) {
  const { password } = await request.json();

  if (password !== serverEnv.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("admin_session", serverEnv.ADMIN_SESSION_SECRET, {
    httpOnly: true,
    secure: serverEnv.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });

  return response;
}
