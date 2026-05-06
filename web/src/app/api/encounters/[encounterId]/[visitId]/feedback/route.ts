import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ visitId: string }>;
}

/**
 * GET /api/encounters/[visitId]/feedback
 * Returns all feedback entries for this encounter.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { visitId } = await context.params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify visit ownership
    const { data: visit } = await supabase
      .from("visits")
      .select("id, user_id")
      .eq("id", visitId)
      .eq("user_id", user.id)
      .single();

    if (!visit) {
      return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    }

    // Fetch feedback for this encounter
    const { data: feedback, error } = await supabase
      .from("section_feedback")
      .select("id, section_id, rating, categories, detail")
      .eq("encounter_id", visitId)
      .eq("user_id", user.id);

    if (error) {
      logger.error("[feedback] Fetch failed:", error);
      return NextResponse.json(
        { error: "Failed to fetch feedback" },
        { status: 500 },
      );
    }

    return NextResponse.json({ feedback: feedback || [] });
  } catch (err) {
    logger.error("[feedback] GET error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/encounters/[visitId]/feedback
 * Submit feedback for a section (or entire encounter if sectionId is null).
 */
export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { visitId } = await context.params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      sectionId,
      sectionKind,
      rating,
      categories = [],
      detail = "",
      remember = false,
    } = body;

    if (!["up", "down"].includes(rating)) {
      return NextResponse.json({ error: "Invalid rating" }, { status: 400 });
    }

    // Fetch visit with template_id
    const { data: visit, error: visitError } = await supabase
      .from("visits")
      .select("id, user_id, metadata")
      .eq("id", visitId)
      .eq("user_id", user.id)
      .single();

    if (visitError || !visit) {
      return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    }

    const templateId =
      (visit.metadata as Record<string, unknown>)?.template_id ||
      "t_W3gidbL2Bf"; // default template

    // For "up" rating: soft-delete any existing negative feedback for this section
    if (rating === "up") {
      await supabase
        .from("section_feedback")
        .update({ resolved_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("encounter_id", visitId)
        .is("resolved_at", null)
        .eq("section_id", sectionId || null);

      return NextResponse.json({ success: true });
    }

    // For "down" rating with remember=false: save encounter-specific only
    if (!remember) {
      const { error: insertError } = await supabase
        .from("section_feedback")
        .insert({
          user_id: user.id,
          encounter_id: visitId,
          template_id: templateId,
          section_id: sectionId || null,
          section_kind: sectionKind || null,
          rating,
          categories,
          detail,
          // No source_snapshot for encounter-specific feedback
        });

      if (insertError) {
        logger.error("[feedback] Insert failed:", insertError);
        return NextResponse.json(
          { error: "Failed to save feedback" },
          { status: 500 },
        );
      }

      return NextResponse.json({ success: true });
    }

    // For "down" rating with remember=true: save cross-encounter feedback
    // Capture source snapshot from visit metadata
    const metadata = (visit.metadata || {}) as Record<string, unknown>;
    const sourceSnapshot = {
      transcript: metadata.transcript || null,
      doctorNotes: metadata.doctor_notes || null,
      files: metadata.files || null,
    };

    const { error: insertError } = await supabase
      .from("section_feedback")
      .insert({
        user_id: user.id,
        encounter_id: visitId,
        template_id: templateId,
        section_id: sectionId || null,
        section_kind: sectionKind || null,
        rating,
        categories,
        detail,
        source_snapshot: sourceSnapshot,
      });

    if (insertError) {
      logger.error("[feedback] Insert failed:", insertError);
      return NextResponse.json(
        { error: "Failed to save feedback" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("[feedback] POST error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
