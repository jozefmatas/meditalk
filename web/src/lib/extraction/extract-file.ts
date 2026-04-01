import type { SupabaseClient } from "@supabase/supabase-js";
import { extractTextFromFile } from "@/lib/file-extraction";
import type { SupportedLanguage } from "@/lib/types";

export interface ExtractFileParams {
  file: {
    id: string;
    type: string;
    path: string;
    name: string;
    source?: string;
  };
  supabase: SupabaseClient;
  userId: string;
  visitId: string;
  language: SupportedLanguage;
  /**
   * Optional real-time transcript text.
   * For recording files, this bypasses audio file download/transcription.
   */
  transcriptText?: string;
}

export interface ExtractFileResult {
  text: string;
  elapsedMs: number;
}

/**
 * Extract text from a file (image, PDF, or audio).
 *
 * This is the shared extraction logic used by both:
 * - /api/generate/route.ts (on-demand during generation)
 * - /api/encounters/[encounterId]/extract/route.ts (background extraction)
 *
 * **Image files:**
 * - Download from storage
 * - Auto-rotate based on EXIF metadata
 * - OCR via Claude Vision
 *
 * **PDF files:**
 * - Create signed URL (5 min expiry)
 * - Extract via Claude document API
 *
 * **Audio files:**
 * - Priority 1: Use real-time transcript if available (fastest!)
 * - Priority 2: Download and transcribe via ElevenLabs Scribe v2
 *
 * **Note:** This function does NOT handle:
 * - Audio anonymization (generate route only)
 * - Metadata save retry logic (handled by calling routes)
 * - File deletion after extraction (handled by calling routes)
 */
export async function extractFileText(
  params: ExtractFileParams,
): Promise<ExtractFileResult> {
  const { file, supabase, userId, visitId, language, transcriptText } = params;
  const startTime = Date.now();

  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf";
  const isAudio = file.type.startsWith("audio/");

  let extractedText: string | null = null;

  if (isImage) {
    // Images: download → EXIF auto-rotate → OCR
    const { data: fileData, error: dlError } = await supabase.storage
      .from("encounter-files")
      .download(file.path);

    if (dlError || !fileData) {
      console.error(`[extract-file] Failed to download ${file.name}:`, dlError);
      throw new Error(
        `File download failed: ${dlError?.message || "Unknown error"}`,
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
    // PDFs: use signed URL so Claude fetches directly (no rotation issue)
    const { data: urlData, error: urlError } = await supabase.storage
      .from("encounter-files")
      .createSignedUrl(file.path, 300); // 5 min expiry

    if (urlError || !urlData?.signedUrl) {
      console.error(
        `[extract-file] Failed to create signed URL for ${file.name}:`,
        urlError,
      );
      throw new Error(
        `Signed URL creation failed: ${urlError?.message || "Unknown error"}`,
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
    // Audio: use real-time transcript if available, otherwise transcribe
    const isRecording =
      file.source === "recording" || file.source === "recording-upload";

    // Priority 1: Use real-time transcript if available (fastest!)
    if (isRecording && transcriptText) {
      console.log(
        `[extract-file] Using real-time transcript (${transcriptText.length} chars) for ${file.name} - skipping download`,
      );
      extractedText = transcriptText;
    } else {
      // Priority 2: Download audio and transcribe
      const { data: fileData, error: dlError } = await supabase.storage
        .from("encounter-files")
        .download(file.path);

      if (dlError || !fileData) {
        console.error(
          `[extract-file] Failed to download ${file.name}:`,
          dlError,
        );
        throw new Error(
          `File download failed: ${dlError?.message || "Unknown error"}`,
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
    }
  } else {
    throw new Error(`Unsupported file type: ${file.type}`);
  }

  if (!extractedText || extractedText.trim().length === 0) {
    throw new Error("Extraction returned empty text");
  }

  const elapsedMs = Date.now() - startTime;

  console.log(
    `[extract-file] Successfully extracted ${extractedText.length} chars from ${file.name} in ${elapsedMs}ms`,
  );

  return {
    text: extractedText,
    elapsedMs,
  };
}
