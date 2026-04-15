import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { logAudit, createAuditContext } from "@/lib/audit";
import type { Encounter, UpdateEncounterRequest } from "@/lib/types";
import { normalizeStatus } from "@/lib/encounters/normalize-status";
import { mergeVisitMetadata } from "@/lib/supabase/merge-metadata";
import { logger } from "@/lib/logger";

interface RouteParams {
  params: Promise<{ encounterId: string }>;
}

/**
 * GET /api/encounters/[encounterId]
 * Get a single visit
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

    logAudit({
      ...createAuditContext(auth, request),
      action: "encounter.view",
      resourceType: "encounter",
      resourceId: visitId,
    });

    return NextResponse.json({
      ...visit,
      status: normalizeStatus(visit.status),
    } as Encounter);
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error("Visit fetch error:", err);
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
    // Metadata is merged atomically via a PostgreSQL RPC to prevent
    // concurrent writers (auto-save, recording, generation) from clobbering
    // each other. Handle it separately from the regular column update.
    const hasMetadata = body.metadata !== undefined;
    if (hasMetadata) {
      await mergeVisitMetadata(
        supabase,
        visitId,
        body.metadata as Record<string, unknown>,
      );
    }

    if (Object.keys(updateData).length === 0 && !hasMetadata) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 },
      );
    }

    // Update non-metadata columns if any were provided
    if (Object.keys(updateData).length > 0) {
      const { data: visit, error } = await supabase
        .from("visits")
        .update(updateData)
        .eq("id", visitId)
        .eq("user_id", userId)
        .select()
        .single();

      if (error) {
        logger.error("Error updating visit:", error);
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
        metadata: {
          fields: [
            ...Object.keys(updateData),
            ...(hasMetadata ? ["metadata"] : []),
          ],
        },
      });

      return NextResponse.json(visit as Encounter);
    }

    // Metadata-only update: fetch the updated visit to return
    const { data: visit, error } = await supabase
      .from("visits")
      .select("*")
      .eq("id", visitId)
      .eq("user_id", userId)
      .single();

    if (error || !visit) {
      return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    }

    logAudit({
      ...createAuditContext(auth, request),
      action: "encounter.update",
      resourceType: "encounter",
      resourceId: visitId,
      metadata: { fields: ["metadata"] },
    });

    return NextResponse.json(visit as Encounter);
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error("Visit update error:", err);
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
          logger.warn("[delete] audio cleanup failed:", audioErr.message);
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
          logger.warn("[delete] files cleanup failed:", filesErr.message);
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
        logger.error("Error deleting visit:", error);
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
        logger.error("Error archiving visit:", error);
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
    logger.error("Visit delete error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
