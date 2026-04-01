import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { extractTextFromFile } from "@/lib/file-extraction";
import type { SupportedLanguage } from "@/lib/types";

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
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ encounterId: string }> },
) {
  const { encounterId: visitId } = await params;

  let userId: string;
  let supabase: Awaited<ReturnType<typeof requireAuth>>["supabase"];

  try {
    const authResult = await requireAuth();
    userId = authResult.userId;
    supabase = authResult.supabase;
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    const visitMeta = (visit.metadata ?? {}) as Record<string, unknown>;
    const uploadedFiles = (visitMeta.files ?? []) as {
      id: string;
      name: string;
      type: string;
      path: string;
      source?: string;
      extracted_text?: string | null;
      extraction_status?: "extracting" | "completed" | "failed" | null;
    }[];

    // Find the file to extract
    const file = uploadedFiles.find((f) => f.id === fileId);
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Skip if already extracted
    if (file.extracted_text && file.extraction_status === "completed") {
      console.log(`[extract] File ${file.name} already has extracted text`);
      return NextResponse.json({
        extracted: true,
        cached: true,
        text: file.extracted_text,
      });
    }

    // Skip if extraction is already in progress (prevent duplicate work)
    if (file.extraction_status === "extracting") {
      console.log(`[extract] File ${file.name} extraction already in progress`);
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

    const startTime = Date.now();
    console.log(`[extract] Extracting text from ${file.name} (${file.type})`);

    // Mark extraction as in progress
    // Re-read metadata to avoid overwriting parallel extractions
    const { data: freshVisit1 } = await supabase
      .from("visits")
      .select("metadata")
      .eq("id", visitId)
      .single();
    const freshMeta1 = (freshVisit1?.metadata ?? {}) as Record<string, unknown>;
    const freshFiles1 = (freshMeta1.files ?? []) as typeof uploadedFiles;
    const freshFile1 = freshFiles1.find((f) => f.id === fileId);
    if (freshFile1) {
      freshFile1.extraction_status = "extracting";
      await supabase
        .from("visits")
        .update({
          metadata: { ...freshMeta1, files: freshFiles1 },
        })
        .eq("id", visitId);
    }

    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";
    const isAudio = file.type.startsWith("audio/");

    let extractedText: string | null = null;

    if (isImage) {
      // Download image for EXIF rotation
      const { data: fileData, error: dlError } = await supabase.storage
        .from("encounter-files")
        .download(file.path);

      if (dlError || !fileData) {
        console.error(`Failed to download ${file.name}:`, dlError);
        return NextResponse.json(
          { error: "File download failed" },
          { status: 500 },
        );
      }

      const buffer = Buffer.from(await fileData.arrayBuffer());
      extractedText = await extractTextFromFile(
        { imageBuffer: buffer },
        file.name,
        file.type,
        language,
        { userId, visitId },
      );
    } else if (isPdf) {
      // PDFs: use signed URL
      const { data: urlData, error: urlError } = await supabase.storage
        .from("encounter-files")
        .createSignedUrl(file.path, 300); // 5 min expiry

      if (urlError || !urlData?.signedUrl) {
        console.error(
          `Failed to create signed URL for ${file.name}:`,
          urlError,
        );
        return NextResponse.json(
          { error: "Signed URL creation failed" },
          { status: 500 },
        );
      }

      extractedText = await extractTextFromFile(
        { pdfUrl: urlData.signedUrl },
        file.name,
        file.type,
        language,
        { userId, visitId },
      );
    } else if (isAudio) {
      // Audio files: transcribe via ElevenLabs
      // Note: Real-time transcript from recording bar will override this during generation
      const { data: fileData, error: dlError } = await supabase.storage
        .from("encounter-files")
        .download(file.path);

      if (dlError || !fileData) {
        console.error(`Failed to download ${file.name}:`, dlError);
        return NextResponse.json(
          { error: "File download failed" },
          { status: 500 },
        );
      }

      const buffer = Buffer.from(await fileData.arrayBuffer());
      extractedText = await extractTextFromFile(
        { buffer },
        file.name,
        file.type,
        language,
        { userId, visitId },
      );
    } else {
      return NextResponse.json(
        { error: "Unsupported file type" },
        { status: 400 },
      );
    }

    // Save extracted text back to metadata
    // Re-read metadata to avoid overwriting parallel extractions
    const { data: freshVisit2 } = await supabase
      .from("visits")
      .select("metadata")
      .eq("id", visitId)
      .single();
    const freshMeta2 = (freshVisit2?.metadata ?? {}) as Record<string, unknown>;
    const freshFiles2 = (freshMeta2.files ?? []) as typeof uploadedFiles;
    const freshFile2 = freshFiles2.find((f) => f.id === fileId);
    if (!freshFile2) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Check if extraction actually succeeded (non-empty text)
    if (!extractedText || extractedText.trim().length === 0) {
      console.warn(
        `[extract] Extraction returned empty text for ${file.name}, marking as failed`,
      );
      freshFile2.extraction_status = "failed";
      await supabase
        .from("visits")
        .update({
          metadata: { ...freshMeta2, files: freshFiles2 },
        })
        .eq("id", visitId);
      return NextResponse.json(
        { error: "Extraction returned empty text", extracted: false },
        { status: 500 },
      );
    }

    freshFile2.extracted_text = extractedText;
    freshFile2.extraction_status = "completed";
    const { error: saveError } = await supabase
      .from("visits")
      .update({
        metadata: { ...freshMeta2, files: freshFiles2 },
      })
      .eq("id", visitId);

    if (saveError) {
      console.error("Failed to save extracted text:", saveError);
      // Mark as failed on save error - re-read to avoid overwriting
      const { data: failVisit } = await supabase
        .from("visits")
        .select("metadata")
        .eq("id", visitId)
        .single();
      if (failVisit) {
        const failMeta = (failVisit.metadata ?? {}) as Record<string, unknown>;
        const failFiles = (failMeta.files ?? []) as typeof uploadedFiles;
        const failFile = failFiles.find((f) => f.id === fileId);
        if (failFile) {
          failFile.extraction_status = "failed";
          // Silent fail on second attempt - don't check for errors
          await supabase
            .from("visits")
            .update({ metadata: { ...failMeta, files: failFiles } })
            .eq("id", visitId);
        }
      }
      return NextResponse.json(
        { error: "Failed to save extracted text" },
        { status: 500 },
      );
    }

    const elapsedMs = Date.now() - startTime;
    console.log(
      `[extract] Extracted ${extractedText?.length || 0} chars from ${file.name} in ${elapsedMs}ms`,
    );

    return NextResponse.json({
      extracted: true,
      cached: false,
      text: extractedText,
      elapsedMs,
    });
  } catch (err) {
    console.error("Extract route error:", err);

    // Mark extraction as failed (only if we have fileId)
    if (fileId) {
      try {
        const { data: visit } = await supabase
          .from("visits")
          .select("metadata")
          .eq("id", visitId)
          .single();

        if (visit) {
          const meta = (visit.metadata ?? {}) as Record<string, unknown>;
          const files = (meta.files ?? []) as {
            id: string;
            name: string;
            type: string;
            path: string;
            source?: string;
            extracted_text?: string | null;
            extraction_status?: "extracting" | "completed" | "failed" | null;
          }[];
          const failedFile = files.find((f) => f.id === fileId);
          if (failedFile) {
            failedFile.extraction_status = "failed";
            // Silent fail on cleanup - don't check for errors
            await supabase
              .from("visits")
              .update({ metadata: { ...meta, files } })
              .eq("id", visitId);
          }
        }
      } catch {
        // Silent fail on cleanup
      }
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
