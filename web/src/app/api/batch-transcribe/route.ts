import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { transcribeAudio } from "@/lib/elevenlabs";
import { logger } from "@/lib/logger";

export const maxDuration = 600;

/**
 * POST /api/batch-transcribe
 *
 * Accepts audio via one of two modes:
 *
 * 1. **Storage path mode** (JSON body) — preferred for large recordings.
 *    The client uploads the blob directly to Supabase Storage (bypassing
 *    Vercel's 4.5 MB body limit) and sends `{ storagePath, language, visitId }`.
 *    The server downloads from storage and transcribes.
 *
 * 2. **Direct blob mode** (FormData) — for small blobs (pause-time snapshots).
 *    The blob is sent as multipart form data. Subject to Vercel body limit.
 */
export async function POST(request: NextRequest) {
  let authResult: Awaited<ReturnType<typeof requireAuth>>;
  try {
    authResult = await requireAuth();
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const contentType = request.headers.get("content-type") || "";

    // ── Storage path mode (JSON body) ──────────────────────────
    if (contentType.includes("application/json")) {
      const body = await request.json();
      const storagePath: string | undefined = body.storagePath;
      const language: string | undefined = body.language;
      const visitId: string | undefined = body.visitId;

      if (!storagePath) {
        return NextResponse.json(
          { error: "Missing storagePath" },
          { status: 400 },
        );
      }

      logger.info(
        `[batch-transcribe] Storage mode: downloading ${storagePath}, language=${language ?? "auto"}`,
      );

      // Retry storage downloads — Supabase can return transient errors on
      // large files or under load. 3 attempts with exponential backoff.
      let audioBlob: Blob | null = null;
      for (let dlAttempt = 0; dlAttempt <= 2; dlAttempt++) {
        const { data: audioData, error: dlError } =
          await authResult.supabase.storage
            .from("encounter-files")
            .download(storagePath);

        if (dlError || !audioData) {
          logger.error(
            `[batch-transcribe] Failed to download from storage (attempt ${dlAttempt + 1}/3):`,
            dlError,
          );
          if (dlAttempt < 2) {
            await new Promise((r) => setTimeout(r, 3000 * (dlAttempt + 1)));
            continue;
          }
          return NextResponse.json(
            { error: "Failed to download audio from storage" },
            { status: 500 },
          );
        }

        audioBlob = audioData;
        break;
      }

      if (!audioBlob) {
        return NextResponse.json(
          { error: "Failed to download audio from storage" },
          { status: 500 },
        );
      }

      const ext = storagePath.substring(storagePath.lastIndexOf("."));

      // Build a File from the Blob directly — avoids the intermediate
      // Blob → ArrayBuffer → Buffer → Uint8Array → File copy chain that
      // triples memory usage for large recordings.
      const mimeMap: Record<string, string> = {
        ".webm": "audio/webm",
        ".ogg": "audio/ogg",
        ".m4a": "audio/mp4",
        ".mp4": "audio/mp4",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".flac": "audio/flac",
      };
      const audioFile = new File([audioBlob], `recording${ext}`, {
        type: mimeMap[ext] || "audio/mpeg",
      });

      logger.info(
        `[batch-transcribe] Transcribing ${audioFile.size} bytes from storage`,
      );

      const text = await transcribeAudio(
        audioFile,
        `recording${ext}`,
        language,
        {
          userId: authResult.userId,
          visitId: visitId ?? "",
        },
      );

      logger.info(
        `[batch-transcribe] Transcribed ${text.length} chars from storage`,
      );

      return NextResponse.json({ text });
    }

    // ── Direct blob mode (FormData) ────────────────────────────
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;
    const language = (formData.get("language") as string) || undefined;
    const visitId = (formData.get("visitId") as string) || undefined;

    if (!audioFile || audioFile.size === 0) {
      return NextResponse.json(
        { error: "Missing audio file" },
        { status: 400 },
      );
    }

    logger.info(
      `[batch-transcribe] Direct mode: ${audioFile.size} bytes (${audioFile.type}), language=${language ?? "auto"}`,
    );

    const text = await transcribeAudio(
      audioFile,
      audioFile.name || "recording.m4a",
      language,
      { userId: authResult.userId, visitId: visitId ?? "" },
    );

    logger.info(`[batch-transcribe] Transcribed ${text.length} chars`);

    return NextResponse.json({ text });
  } catch (err) {
    logger.error("[batch-transcribe] Failed:", err);
    return NextResponse.json(
      { error: "Transcription failed" },
      { status: 500 },
    );
  }
}
