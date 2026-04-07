import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { transcribeAudio } from "@/lib/elevenlabs";
import { logger } from "@/lib/logger";

export const maxDuration = 120;

/**
 * POST /api/batch-transcribe
 *
 * Accepts an audio blob via FormData and returns a batch transcript.
 * Used as fallback when Scribe real-time streaming fails (e.g. screen lock
 * kills the WebSocket but MediaRecorder keeps recording).
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

    logger.debug(
      `[batch-transcribe] Transcribing ${audioFile.size} bytes (${audioFile.type}), language=${language ?? "auto"}`,
    );

    const text = await transcribeAudio(
      audioFile,
      audioFile.name || "recording.webm",
      language,
      { userId: authResult.userId, visitId: visitId ?? "" },
    );

    logger.debug(`[batch-transcribe] Transcribed ${text.length} chars`);

    return NextResponse.json({ text });
  } catch (err) {
    logger.error("[batch-transcribe] Failed:", err);
    return NextResponse.json(
      { error: "Transcription failed" },
      { status: 500 },
    );
  }
}
