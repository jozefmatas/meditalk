import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { fetchTemplatesFromDb } from "@/lib/templates/db";
import { TEMPLATES } from "@/lib/templates";

/**
 * GET /api/templates
 *
 * Returns all visible templates from Supabase (RLS applies:
 * visible system templates + user's own custom templates).
 * Falls back to static TEMPLATES if auth or DB fails.
 */
export async function GET() {
  try {
    const { supabase } = await requireAuth();
    const templates = await fetchTemplatesFromDb(supabase);
    return NextResponse.json(templates);
  } catch {
    // Auth failed or other error — return static templates
    return NextResponse.json(TEMPLATES);
  }
}
