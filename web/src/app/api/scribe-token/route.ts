import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { generateScribeToken } from "@/lib/elevenlabs";

export async function POST() {
  try {
    await requireAuth();
    const token = await generateScribeToken();
    return NextResponse.json({ token });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Scribe token error:", err);
    return NextResponse.json(
      { error: "Failed to generate token" },
      { status: 500 },
    );
  }
}
