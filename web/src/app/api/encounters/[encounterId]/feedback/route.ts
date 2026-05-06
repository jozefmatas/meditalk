import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { logAudit, createAuditContext } from "@/lib/audit";
import { logger } from "@/lib/logger";

interface RouteParams {
  params: Promise<{ encounterId: string }>;
}

/**
 * POST /api/encounters/[encounterId]/feedback
 * Submit feedback on a generated note section (or globally).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    const { userId, supabase } = auth;
    const { encounterId: visitId } = await params;

    const body = await request.json();
    const {
      sectionId,
      sectionKind,
      rating,
      categories,
      detail,
      remember = false,
    } = body;

    if (!rating || !["up", "down"].includes(rating)) {
      return NextResponse.json(
        { error: "rating must be 'up' or 'down'" },
        { status: 400 },
      );
    }

    // Fetch encounter for template_id + section content snapshot
    const { data: visit, error: fetchError } = await supabase
      .from("visits")
      .select("metadata")
      .eq("id", visitId)
      .eq("user_id", userId)
      .single();

    if (fetchError || !visit) {
      return NextResponse.json(
        { error: "Encounter not found" },
        { status: 404 },
      );
    }

    const metadata = visit.metadata ?? {};
    const templateId = metadata.template_id;
    const sectionContents = metadata.section_contents ?? {};

    // For "up" rating: resolve any existing negative feedback
    if (rating === "up") {
      await supabase
        .from("section_feedback")
        .update({ resolved_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("visit_id", visitId)
        .is("resolved_at", null)
        .eq("section_id", sectionId || null);

      return NextResponse.json({ success: true });
    }

    // For "down" rating with remember=false: encounter-specific only
    // For "down" rating with remember=true: cross-encounter learning
    const sourceSnapshot = remember
      ? {
          transcript: metadata.transcript,
          doctor_notes: metadata.doctor_notes,
          files: metadata.files,
        }
      : null;

    const { data, error } = await supabase
      .from("section_feedback")
      .insert({
        visit_id: visitId,
        user_id: userId,
        template_id: templateId,
        section_id: sectionId ?? null,
        section_kind: sectionKind ?? null,
        rating,
        categories: categories ?? [],
        detail: detail ?? "",
        source_snapshot: sourceSnapshot,
      })
      .select("id");

    if (error) {
      logger.error("[feedback] Insert failed:", error);
      return NextResponse.json(
        { error: "Failed to save feedback" },
        { status: 500 },
      );
    }

    logAudit({
      ...createAuditContext(auth, request),
      action: "feedback.submit",
      resourceType: "encounter",
      resourceId: visitId,
      metadata: { sectionId, rating },
    });

    return NextResponse.json({ id: data[0].id });
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error("Feedback submit error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/encounters/[encounterId]/feedback
 * Remove feedback for a section (toggle thumbs-up off).
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    const { userId, supabase } = auth;
    const { encounterId: visitId } = await params;

    const body = await request.json();
    const { sectionId } = body;

    // Mark all feedback for this section as resolved
    const { error } = await supabase
      .from("section_feedback")
      .update({ resolved_at: new Date().toISOString() })
      .eq("visit_id", visitId)
      .eq("user_id", userId)
      .eq("section_id", sectionId ?? null)
      .is("resolved_at", null);

    if (error) {
      logger.error("[feedback] Delete failed:", error);
      return NextResponse.json(
        { error: "Failed to remove feedback" },
        { status: 500 },
      );
    }

    logAudit({
      ...createAuditContext(auth, request),
      action: "feedback.remove",
      resourceType: "encounter",
      resourceId: visitId,
      metadata: { sectionId },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error("Feedback remove error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/encounters/[encounterId]/feedback
 * Retrieve all feedback for this encounter by the current user.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    const { userId, supabase } = auth;
    const { encounterId: visitId } = await params;

    const { data, error } = await supabase
      .from("section_feedback")
      .select("id, section_id, rating, categories, detail, created_at")
      .eq("visit_id", visitId)
      .eq("user_id", userId);

    if (error) {
      logger.error("[feedback] Fetch failed:", error);
      return NextResponse.json(
        { error: "Failed to fetch feedback" },
        { status: 500 },
      );
    }

    return NextResponse.json({ feedback: data ?? [] });
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error("Feedback fetch error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
