import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { transcribeAudio } from "@/lib/elevenlabs";
import { embedTexts } from "@/lib/openai";
import { chunkText } from "@/lib/chunking";
import type { ProcessAudioResponse, SupportedLanguage } from "@/lib/types";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

/** Accept any audio/* MIME type — Whisper handles all major formats */
function isAudioMime(type: string): boolean {
  return type.split(";")[0].trim().startsWith("audio/");
}

const VALID_LANGUAGES: SupportedLanguage[] = ["en", "sk", "cs"];

/**
 * POST /api/process-audio
 * Accepts JSON (audio already in storage) or FormData (legacy fallback).
 * Transcribes, chunks, and embeds audio. Cleans up storage after extraction.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId, supabase } = await requireAuth();

    const contentType = request.headers.get("content-type") || "";

    let audioPath: string;
    let language: string;
    let existingVisitId: string | null;
    let preTranscript: string | null;
    let title: string | null = null;

    if (contentType.includes("application/json")) {
      // New path: audio already uploaded to Supabase Storage by the client
      const body = await request.json();
      audioPath = body.audioPath;
      language = body.language || "en";
      existingVisitId = body.visitId || null;
      preTranscript = body.transcriptText || null;

      if (!audioPath) {
        return NextResponse.json(
          { error: "No audioPath provided" },
          { status: 400 },
        );
      }

      // Validate path belongs to authenticated user
      if (!audioPath.startsWith(`${userId}/`)) {
        return NextResponse.json(
          { error: "Invalid audio path" },
          { status: 403 },
        );
      }
    } else {
      // Legacy FormData path (fallback)
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      title = (formData.get("title") as string) || null;
      language = (formData.get("language") as string) || "en";
      existingVisitId = (formData.get("visitId") as string) || null;
      preTranscript = (formData.get("transcriptText") as string) || null;

      if (!file) {
        return NextResponse.json(
          { error: "No audio file provided" },
          { status: 400 },
        );
      }

      if (!isAudioMime(file.type)) {
        return NextResponse.json(
          { error: `Unsupported file type: ${file.type}` },
          { status: 400 },
        );
      }

      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: "File exceeds 50 MB limit" },
          { status: 400 },
        );
      }

      // Upload to storage (legacy path)
      const fileId = crypto.randomUUID();
      audioPath = `${userId}/${fileId}-${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from("encounter-files")
        .upload(audioPath, file, { contentType: file.type });

      if (uploadError) {
        return NextResponse.json(
          { error: "Failed to upload audio file" },
          { status: 500 },
        );
      }
    }

    if (!VALID_LANGUAGES.includes(language as SupportedLanguage)) {
      return NextResponse.json(
        { error: `Unsupported language: ${language}` },
        { status: 400 },
      );
    }

    // Transcription: use pre-transcript if available, else download + batch transcribe
    let rawText: string;
    const usageCtx = { userId, visitId: existingVisitId || undefined };

    if (preTranscript) {
      rawText = preTranscript;
    } else {
      // Download from storage for batch transcription
      const { data: fileData, error: dlError } = await supabase.storage
        .from("encounter-files")
        .download(audioPath);

      if (dlError || !fileData) {
        return NextResponse.json(
          { error: "Failed to download audio for transcription" },
          { status: 500 },
        );
      }

      const filename = audioPath.split("/").pop() || "audio.webm";
      const file = new File([fileData], filename, {
        type: fileData.type || "audio/webm",
      });
      rawText = await transcribeAudio(file, filename, usageCtx);
    }

    let visitId: string;

    if (existingVisitId) {
      // Attach audio to an existing visit
      const { data: existing } = await supabase
        .from("visits")
        .select("id")
        .eq("id", existingVisitId)
        .eq("user_id", userId)
        .single();

      if (!existing) {
        return NextResponse.json({ error: "Visit not found" }, { status: 404 });
      }

      const { error: updateError } = await supabase
        .from("visits")
        .update({ raw_text: rawText })
        .eq("id", existingVisitId);

      if (updateError) {
        return NextResponse.json(
          { error: "Failed to update visit" },
          { status: 500 },
        );
      }

      // Remove old chunks before inserting new ones
      await supabase
        .from("transcript_chunks")
        .delete()
        .eq("visit_id", existingVisitId);

      visitId = existingVisitId;
    } else {
      // Create a new visit row
      const { data: visit, error: insertError } = await supabase
        .from("visits")
        .insert({
          user_id: userId,
          title,
          raw_text: rawText,
          language,
          visit_date: new Date().toISOString(),
          status: "started",
        })
        .select("id")
        .single();

      if (insertError || !visit) {
        return NextResponse.json(
          { error: "Failed to save visit" },
          { status: 500 },
        );
      }

      visitId = visit.id;
    }

    // Chunk and embed
    const chunks = chunkText(rawText);
    const embeddings = await embedTexts(chunks, { userId, visitId });

    const chunkRows = chunks.map((content, i) => ({
      visit_id: visitId,
      chunk_index: i,
      content,
      embedding: JSON.stringify(embeddings[i]),
    }));

    const { error: chunksError } = await supabase
      .from("transcript_chunks")
      .insert(chunkRows);

    if (chunksError) {
      return NextResponse.json(
        { error: "Failed to save visit chunks" },
        { status: 500 },
      );
    }

    // Cleanup: delete audio from storage (text already extracted)
    await supabase.storage
      .from("encounter-files")
      .remove([audioPath])
      .catch(() => {});

    const response: ProcessAudioResponse = {
      visitId,
      audioPath: "",
      chunkCount: chunks.length,
      transcriptText: rawText,
    };

    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
