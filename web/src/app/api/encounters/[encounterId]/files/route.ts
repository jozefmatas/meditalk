import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { logAudit, createAuditContext } from "@/lib/audit";

interface RouteParams {
  params: Promise<{ encounterId: string }>;
}

/**
 * GET /api/encounters/[encounterId]/files
 * List files stored in encounter metadata.files[]
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { userId, supabase } = await requireAuth();
    const { encounterId } = await params;

    const { data: visit, error } = await supabase
      .from("visits")
      .select("metadata")
      .eq("id", encounterId)
      .eq("user_id", userId)
      .single();

    if (error || !visit) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const meta = (visit.metadata ?? {}) as Record<string, unknown>;
    const files = (meta.files ?? []) as Record<string, unknown>[];

    return NextResponse.json({ files });
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/encounters/[encounterId]/files
 * Register file metadata in visit.metadata.files[].
 * Accepts JSON (files already uploaded to storage by client) or FormData (legacy).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    const { userId, supabase } = auth;
    const { encounterId } = await params;

    // Verify ownership
    const { data: visit, error: visitError } = await supabase
      .from("visits")
      .select("metadata")
      .eq("id", encounterId)
      .eq("user_id", userId)
      .single();

    if (visitError || !visit) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const contentType = request.headers.get("content-type") || "";
    let newFiles: Record<string, unknown>[];

    if (contentType.includes("application/json")) {
      // New path: files already in Supabase Storage, just register metadata
      const body = await request.json();
      const preUploaded = body.files as Array<{
        id: string;
        name: string;
        size: number;
        type: string;
        path: string;
        source?: string;
      }>;

      if (!preUploaded?.length) {
        return NextResponse.json(
          { error: "No files provided" },
          { status: 400 },
        );
      }

      // Validate each path belongs to the authenticated user.
      // When an admin is impersonating, the client-side upload uses the
      // admin's real userId (because client auth token is unchanged) so we
      // accept paths starting with either the impersonated or real userId.
      const { isImpersonating, realUserId } = auth;
      for (const f of preUploaded) {
        const ownsPath =
          f.path.startsWith(`${userId}/`) ||
          (isImpersonating && f.path.startsWith(`${realUserId}/`));
        if (!ownsPath) {
          return NextResponse.json(
            { error: "Invalid file path" },
            { status: 403 },
          );
        }
      }

      newFiles = preUploaded.map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        type: f.type,
        path: f.path,
        ...(f.source ? { source: f.source } : {}),
      }));
    } else {
      // Legacy FormData path (fallback)
      const formData = await request.formData();
      const uploadedFiles = formData.getAll("files") as File[];

      if (uploadedFiles.length === 0) {
        return NextResponse.json(
          { error: "No files provided" },
          { status: 400 },
        );
      }

      newFiles = [];

      for (const file of uploadedFiles) {
        const fileId = crypto.randomUUID();
        const storagePath = `${userId}/${encounterId}/${fileId}-${file.name}`;

        const buffer = Buffer.from(await file.arrayBuffer());
        const { error: uploadError } = await supabase.storage
          .from("encounter-files")
          .upload(storagePath, buffer, {
            contentType: file.type,
            upsert: false,
          });

        if (uploadError) {
          console.error("File upload error:", uploadError);
          continue;
        }

        newFiles.push({
          id: fileId,
          name: file.name,
          size: file.size,
          type: file.type,
          path: storagePath,
        });
      }
    }

    // Update visit metadata with new files
    const meta = (visit.metadata ?? {}) as Record<string, unknown>;
    const existingFiles = (meta.files ?? []) as Record<string, unknown>[];
    const updatedFiles = [...existingFiles, ...newFiles];
    const { error: updateError } = await supabase
      .from("visits")
      .update({ metadata: { ...meta, files: updatedFiles } })
      .eq("id", encounterId)
      .eq("user_id", userId);

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to update metadata" },
        { status: 500 },
      );
    }

    logAudit({
      ...createAuditContext(auth, request),
      action: "file.upload",
      resourceType: "encounter",
      resourceId: encounterId,
      metadata: {
        count: newFiles.length,
        names: newFiles.map((f) => f.name),
      },
    });

    return NextResponse.json({ files: newFiles });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("File upload error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/encounters/[encounterId]/files?fileId=...
 * Remove a file from storage and metadata
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    const { userId, supabase } = auth;
    const { encounterId } = await params;
    const fileId = request.nextUrl.searchParams.get("fileId");

    if (!fileId) {
      return NextResponse.json({ error: "fileId required" }, { status: 400 });
    }

    const { data: visit, error: visitError } = await supabase
      .from("visits")
      .select("metadata")
      .eq("id", encounterId)
      .eq("user_id", userId)
      .single();

    if (visitError || !visit) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const meta = (visit.metadata ?? {}) as Record<string, unknown>;
    const files = (meta.files ?? []) as Record<string, unknown>[];
    const fileToDelete = files.find((f) => f.id === fileId);

    if (!fileToDelete) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Remove from storage
    if (fileToDelete.path) {
      await supabase.storage
        .from("encounter-files")
        .remove([fileToDelete.path as string]);
    }

    // Remove from metadata
    const updatedFiles = files.filter((f) => f.id !== fileId);
    await supabase
      .from("visits")
      .update({ metadata: { ...meta, files: updatedFiles } })
      .eq("id", encounterId)
      .eq("user_id", userId);

    logAudit({
      ...createAuditContext(auth, request),
      action: "file.delete",
      resourceType: "encounter",
      resourceId: encounterId,
      metadata: { fileId },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("File delete error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
