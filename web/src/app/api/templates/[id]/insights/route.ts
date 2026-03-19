import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/templates/:id/insights
 * Get template insights for the current user.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { userId, supabase } = await requireAuth();
    const { id } = await context.params;

    const { data, error } = await supabase
      .from("template_insights")
      .select("*")
      .eq("template_id", id)
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      return NextResponse.json({
        example_notes: [],
        style_guide: null,
        edit_diffs: [],
        preference_summary: null,
        usage_count: 0,
        last_used_at: null,
      });
    }

    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Insights fetch error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/templates/:id/insights
 * Upsert template insights (example notes + style guide).
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { userId, supabase } = await requireAuth();
    const { id } = await context.params;
    const body = await request.json();

    const { exampleNotes, styleGuide } = body;

    const { error } = await supabase.from("template_insights").upsert(
      {
        user_id: userId,
        template_id: id,
        example_notes: exampleNotes ?? [],
        style_guide: styleGuide ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,template_id" },
    );

    if (error) {
      console.error("Error upserting insights:", error);
      return NextResponse.json(
        { error: "Failed to save insights" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Insights upsert error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
