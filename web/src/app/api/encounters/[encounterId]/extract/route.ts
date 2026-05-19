import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/with-auth";
import { extractFileText } from "@/lib/extraction/extract-file";
import type {
  SupportedLanguage,
  FileMetadata,
  VisitMetadata,
} from "@/lib/types";
import { logger } from "@/lib/logger";

export const maxDuration = 300;

/**
 * POST /api/encounters/[encounterId]/extract
 *
 * Immediately extracts text from uploaded files and saves to metadata.
 * This allows extraction to happen in the background right after upload,
 * so generation can use cached extracted_text instead of re-extracting.
 *
 * Expected savings: 15-50 seconds per file during generation
 */
export const POST = withAuth<{ encounterId: string }>(
  async ({ request, auth, params }) => {
    const { encounterId: visitId } = params;
    const { userId, supabase } = auth;

    let fileId: string | undefined;
    try {
      const body = await request.json();
      fileId = body.fileId;

      if (!fileId) {
        return NextResponse.json(
          { error: "Missing required field: fileId" },
          { status: 400 },
        );
      }

      // Fetch visit to get metadata and language (RLS enforces ownership)
      const { data: visit, error: visitError } = await supabase
        .from("visits")
        .select("id, language, metadata")
        .eq("id", visitId)
        .single();

      if (visitError || !visit) {
        return NextResponse.json({ error: "Visit not found" }, { status: 404 });
      }

      const language = (visit.language as SupportedLanguage) || "en";
      const visitMeta = (visit.metadata ?? {}) as VisitMetadata;
      const uploadedFiles: FileMetadata[] = visitMeta.files ?? [];

      // Find the file to extract
      const file = uploadedFiles.find((f) => f.id === fileId);
      if (!file) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }

      // Skip if already extracted
      if (file.extracted_text && file.extraction_status === "completed") {
        logger.debug(`[extract] File ${file.name} already has extracted text`);
        return NextResponse.json({
          extracted: true,
          cached: true,
          text: file.extracted_text,
        });
      }

      // Skip if extraction is already in progress (prevent duplicate work)
      if (file.extraction_status === "extracting") {
        logger.debug(
          `[extract] File ${file.name} extraction already in progress`,
        );
        return NextResponse.json({
          extracted: false,
          inProgress: true,
          message: "Extraction already in progress",
        });
      }

      // Skip if no path (shouldn't happen)
      if (!file.path) {
        return NextResponse.json(
          { error: "File has no storage path" },
          { status: 400 },
        );
      }

      const filePath = file.path;
      const startTime = Date.now();
      logger.debug(
        `[extract] Extracting text from ${file.name} (${file.type})`,
      );

      // Mark extraction as in progress using atomic update
      const { error: extractingError } = await supabase.rpc(
        "update_file_extraction_status",
        {
          p_visit_id: visitId,
          p_file_id: fileId,
          p_status: "extracting",
        },
      );

      if (extractingError) {
        logger.error(
          `[extract] Failed to set status="extracting" for ${file.name}:`,
          extractingError,
        );
      }

      // Extract text using shared extraction service
      let extractedText: string;
      try {
        const result = await extractFileText({
          file: { ...file, path: filePath },
          supabase,
          userId,
          visitId,
          language,
        });
        extractedText = result.text;
        logger.debug(`[extract] Extraction took ${result.elapsedMs}ms`);
      } catch (extractError) {
        const errorMsg =
          extractError instanceof Error
            ? extractError.message
            : "Unknown extraction error";
        logger.error(
          `[extract] Extraction failed for ${file.name}:`,
          extractError,
        );

        // Mark as failed so it doesn't stay "extracting" forever
        await supabase.rpc("update_file_extraction_status", {
          p_visit_id: visitId,
          p_file_id: fileId,
          p_status: "failed",
        });

        return NextResponse.json(
          { error: `Extraction failed: ${errorMsg}` },
          { status: 500 },
        );
      }

      // Check if extraction actually succeeded (non-empty text)
      if (!extractedText || extractedText.trim().length === 0) {
        logger.warn(
          `[extract] Extraction returned empty text for ${file.name}, marking as failed`,
        );
        // Use atomic update to mark as failed
        await supabase.rpc("update_file_extraction_status", {
          p_visit_id: visitId,
          p_file_id: fileId,
          p_status: "failed",
        });
        return NextResponse.json(
          { error: "Extraction returned empty text", extracted: false },
          { status: 500 },
        );
      }

      // Atomic update: set status=completed + extracted_text in one RPC call.
      // Retry with backoff — losing the extracted text after a successful OCR
      // call is expensive, so we try hard to persist it.
      const RETRY_DELAYS = [500, 1000, 2000];
      let rpcError: unknown = null;

      for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
        const { error } = await supabase.rpc("update_file_extraction_status", {
          p_visit_id: visitId,
          p_file_id: fileId,
          p_status: "completed",
          p_extracted_text: extractedText,
        });

        if (!error) {
          rpcError = null;
          break;
        }

        // The user deleted the file mid-OCR — the RPC raises P0001
        // "File not found". Retrying won't help; exit silently.
        if (isFileNotFoundError(error)) {
          logger.debug(
            `[extract] File ${fileId} was deleted during extraction — skipping persist`,
          );
          return NextResponse.json({
            extracted: true,
            persisted: false,
            fileDeleted: true,
          });
        }

        rpcError = error;
        if (attempt < RETRY_DELAYS.length) {
          logger.warn(
            `[extract] RPC save retry ${attempt + 1}/${RETRY_DELAYS.length} for ${file.name}:`,
            error,
          );
          await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        }
      }

      if (rpcError) {
        logger.error(
          `[extract] Atomic update failed after ${RETRY_DELAYS.length + 1} attempts for ${file.name}:`,
          rpcError,
        );
        logger.error(
          `[extract] LOST TEXT file=${fileId} visit=${visitId} len=${extractedText.length}`,
        );
        return NextResponse.json(
          { error: "Failed to save extracted text" },
          { status: 500 },
        );
      }

      const elapsedMs = Date.now() - startTime;
      logger.debug(
        `[extract] ${file.name}: ${extractedText.length} chars in ${elapsedMs}ms`,
      );

      return NextResponse.json({
        extracted: true,
        cached: false,
        text: extractedText,
        elapsedMs,
      });
    } catch (err) {
      // Cleanup: mark extraction as failed so the file doesn't sit in
      // "extracting" forever. Then re-throw so withAuth returns the 500.
      if (fileId) {
        try {
          await supabase.rpc("update_file_extraction_status", {
            p_visit_id: visitId,
            p_file_id: fileId,
            p_status: "failed",
          });
        } catch {
          // Silent fail on cleanup
        }
      }
      throw err;
    }
  },
  { logPrefix: "extract-file" },
);

/**
 * The `update_file_extraction_status` RPC raises Postgres P0001 with a
 * "File not found" message when the file was removed from
 * `metadata.files[]` between extraction start and save. We detect this
 * specific shape so we can exit silently instead of retrying + logging.
 */
function isFileNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  return (
    e.code === "P0001" &&
    typeof e.message === "string" &&
    e.message.startsWith("File not found")
  );
}
