import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { logAudit, createAuditContext } from "@/lib/audit";
import type {
  Encounter,
  EncounterStatus,
  UpdateEncounterRequest,
} from "@/lib/types";

/** Normalize legacy DB statuses to current values */
function normalizeStatus(status: string): EncounterStatus {
  if (status === "draft") return "started";
  if (status === "review") return "to_review";
  if (status === "closed") return "completed";
  return status as EncounterStatus;
}

interface RouteParams {
  params: Promise<{ encounterId: string }>;
}

/**
 * GET /api/encounters/[encounterId]
 * Get a single visit with its chunks
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    const { userId, supabase } = auth;
    const { encounterId: visitId } = await params;

    // Get visit
    const { data: visit, error } = await supabase
      .from("visits")
      .select("*")
      .eq("id", visitId)
      .eq("user_id", userId)
      .single();

    if (error || !visit) {
      return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    }

    // Get chunks count
    const { count: chunkCount } = await supabase
      .from("transcript_chunks")
      .select("*", { count: "exact", head: true })
      .eq("visit_id", visitId);

    logAudit({
      ...createAuditContext(auth, request),
      action: "encounter.view",
      resourceType: "encounter",
      resourceId: visitId,
    });

    return NextResponse.json({
      ...visit,
      status: normalizeStatus(visit.status),
      chunkCount: chunkCount || 0,
    } as Encounter & { chunkCount: number });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Visit fetch error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/encounters/[encounterId]
 * Update a visit
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    const { userId, supabase } = auth;
    const { encounterId: visitId } = await params;

    const body: UpdateEncounterRequest = await request.json();

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {};
    if (body.title !== undefined) updateData.title = body.title;
    if (body.patient_name !== undefined)
      updateData.patient_name = body.patient_name;
    if (body.patient_id !== undefined) updateData.patient_id = body.patient_id;
    if (body.visit_type !== undefined) updateData.visit_type = body.visit_type;
    if (body.visit_date !== undefined) updateData.visit_date = body.visit_date;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.language !== undefined) updateData.language = body.language;
    if (body.encounter_note !== undefined)
      updateData.encounter_note = body.encounter_note;
    if (body.patient_letter !== undefined)
      updateData.patient_letter = body.patient_letter;

    // Merge metadata instead of replacing to prevent race conditions
    if (body.metadata !== undefined) {
      // Fetch current metadata to merge with
      const { data: current } = await supabase
        .from("visits")
        .select("metadata")
        .eq("id", visitId)
        .eq("user_id", userId)
        .single();

      const currentMeta = (current?.metadata ?? {}) as Record<string, unknown>;
      updateData.metadata = { ...currentMeta, ...body.metadata };
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 },
      );
    }

    const { data: visit, error } = await supabase
      .from("visits")
      .update(updateData)
      .eq("id", visitId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      console.error("Error updating visit:", error);
      return NextResponse.json(
        { error: "Failed to update visit" },
        { status: 500 },
      );
    }

    if (!visit) {
      return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    }

    logAudit({
      ...createAuditContext(auth, request),
      action: "encounter.update",
      resourceType: "encounter",
      resourceId: visitId,
      metadata: { fields: Object.keys(updateData) },
    });

    return NextResponse.json(visit as Encounter);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Visit update error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/encounters/[encounterId]
 * Delete a visit (soft delete by default, hard delete with ?hard=true)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    const { userId, supabase } = auth;
    const { encounterId: visitId } = await params;

    const searchParams = request.nextUrl.searchParams;
    const hardDelete = searchParams.get("hard") === "true";

    if (hardDelete) {
      // Get audio path + file metadata to clean up storage
      const { data: visit } = await supabase
        .from("visits")
        .select("audio_path, metadata")
        .eq("id", visitId)
        .eq("user_id", userId)
        .single();

      const storageErrors: string[] = [];

      // Delete audio recording from storage
      if (visit?.audio_path) {
        const { error: audioErr } = await supabase.storage
          .from("audio")
          .remove([visit.audio_path]);
        if (audioErr) {
          console.warn("[delete] audio cleanup failed:", audioErr.message);
          storageErrors.push(`audio: ${audioErr.message}`);
        }
      }

      // Delete encounter files from storage
      const files: { path?: string }[] = visit?.metadata?.files ?? [];
      const filePaths = files.map((f) => f.path).filter(Boolean) as string[];
      if (filePaths.length > 0) {
        const { error: filesErr } = await supabase.storage
          .from("encounter-files")
          .remove(filePaths);
        if (filesErr) {
          console.warn("[delete] files cleanup failed:", filesErr.message);
          storageErrors.push(`files: ${filesErr.message}`);
        }
      }

      // Hard delete (will cascade to chunks)
      const { error } = await supabase
        .from("visits")
        .delete()
        .eq("id", visitId)
        .eq("user_id", userId);

      if (error) {
        console.error("Error deleting visit:", error);
        return NextResponse.json(
          { error: "Failed to delete visit" },
          { status: 500 },
        );
      }

      logAudit({
        ...createAuditContext(auth, request),
        action: "encounter.delete",
        resourceType: "encounter",
        resourceId: visitId,
        metadata: {
          filesRemoved: filePaths.length,
          audioRemoved: !!visit?.audio_path,
          ...(storageErrors.length > 0 && { storageErrors }),
        },
      });
    } else {
      // Soft delete (archive)
      const { error } = await supabase
        .from("visits")
        .update({ status: "archived" })
        .eq("id", visitId)
        .eq("user_id", userId);

      if (error) {
        console.error("Error archiving visit:", error);
        return NextResponse.json(
          { error: "Failed to archive visit" },
          { status: 500 },
        );
      }
    }

    if (!hardDelete) {
      logAudit({
        ...createAuditContext(auth, request),
        action: "encounter.archive",
        resourceType: "encounter",
        resourceId: visitId,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Visit delete error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
