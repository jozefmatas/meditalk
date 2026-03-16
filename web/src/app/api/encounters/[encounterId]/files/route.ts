import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";

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
 * Upload file(s) to Supabase Storage, store metadata in visit.metadata.files[]
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { userId, supabase } = await requireAuth();
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

    const formData = await request.formData();
    const uploadedFiles = formData.getAll("files") as File[];

    if (uploadedFiles.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const meta = (visit.metadata ?? {}) as Record<string, unknown>;
    const existingFiles = (meta.files ?? []) as Record<string, unknown>[];
    const newFiles: Record<string, unknown>[] = [];

    for (const file of uploadedFiles) {
      const fileId = crypto.randomUUID();
      const storagePath = `${userId}/${encounterId}/${fileId}-${file.name}`;

      // Upload to Supabase Storage
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

      const fileMeta: Record<string, unknown> = {
        id: fileId,
        name: file.name,
        size: file.size,
        type: file.type,
        path: storagePath,
      };

      newFiles.push(fileMeta);
    }

    // Update visit metadata with new files
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
    const { userId, supabase } = await requireAuth();
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
