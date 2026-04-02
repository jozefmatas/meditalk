import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";

/** List all files in a storage bucket under a prefix, handling pagination. */
async function listAllFiles(
  sb: ReturnType<typeof supabaseAdmin>,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const paths: string[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const { data, error } = await sb.storage
      .from(bucket)
      .list(prefix, { limit, offset });

    if (error || !data || data.length === 0) break;

    for (const file of data) {
      // Skip folder placeholders
      if (file.name) paths.push(`${prefix}/${file.name}`);
    }

    if (data.length < limit) break;
    offset += limit;
  }

  return paths;
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;

  try {
    const sb = supabaseAdmin();
    const storageErrors: string[] = [];

    // Clean up storage files before deleting DB rows
    const encounterFiles = await listAllFiles(sb, "encounter-files", userId);
    if (encounterFiles.length > 0) {
      const { error } = await sb.storage
        .from("encounter-files")
        .remove(encounterFiles);
      if (error) {
        logger.warn(
          "[user-delete] encounter-files cleanup failed:",
          error.message,
        );
        storageErrors.push(`encounter-files: ${error.message}`);
      }
    }

    const audioFiles = await listAllFiles(sb, "audio", userId);
    if (audioFiles.length > 0) {
      const { error } = await sb.storage.from("audio").remove(audioFiles);
      if (error) {
        logger.warn("[user-delete] audio cleanup failed:", error.message);
        storageErrors.push(`audio: ${error.message}`);
      }
    }

    // Delete user data from app tables
    await sb.from("api_usage").delete().eq("user_id", userId);
    await sb.from("visits").delete().eq("user_id", userId);

    // Delete the auth user
    const { error } = await sb.auth.admin.deleteUser(userId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Fire-and-forget audit log
    sb.from("audit_logs")
      .insert({
        actor_id: userId,
        action: "admin.user_delete",
        resource_type: "user",
        resource_id: userId,
        metadata: {
          encounterFilesRemoved: encounterFiles.length,
          audioFilesRemoved: audioFiles.length,
          ...(storageErrors.length > 0 && { storageErrors }),
        },
      })
      .then(({ error: auditErr }) => {
        if (auditErr)
          logger.error("[audit] user_delete log failed:", auditErr.message);
      });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to delete user" },
      { status: 500 },
    );
  }
}
