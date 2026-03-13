import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { transcribeAudio } from '@/lib/elevenlabs';
import { embedTexts } from '@/lib/openai';
import { chunkText } from '@/lib/chunking';
import type { ProcessAudioResponse, SupportedLanguage } from '@/lib/types';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

/** Accept any audio/* MIME type — Whisper handles all major formats */
function isAudioMime(type: string): boolean {
  return type.split(';')[0].trim().startsWith('audio/');
}

const VALID_LANGUAGES: SupportedLanguage[] = ['en', 'sk', 'cs'];

export async function POST(request: NextRequest) {
  try {
    const { userId, supabase } = await requireAuth();

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const title = (formData.get('title') as string) || null;
    const language = (formData.get('language') as string) || 'en';
    const existingVisitId = (formData.get('visitId') as string) || null;
    const preTranscript = (formData.get('transcriptText') as string) || null;

    if (!file) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    if (!isAudioMime(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type}` },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File exceeds 50 MB limit' },
        { status: 400 }
      );
    }

    if (!VALID_LANGUAGES.includes(language as SupportedLanguage)) {
      return NextResponse.json(
        { error: `Unsupported language: ${language}` },
        { status: 400 }
      );
    }

    // Upload to Supabase Storage
    const fileId = crypto.randomUUID();
    const audioPath = `${userId}/${fileId}-${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from('encounter-files')
      .upload(audioPath, file, { contentType: file.type });

    if (uploadError) {
      return NextResponse.json(
        { error: 'Failed to upload audio file' },
        { status: 500 }
      );
    }

    // Use pre-transcribed text from real-time streaming, or fall back to batch
    const usageCtx = { userId, visitId: existingVisitId || undefined };
    const rawText = preTranscript || await transcribeAudio(file, file.name, usageCtx);

    let visitId: string;

    if (existingVisitId) {
      // Attach audio to an existing visit
      const { data: existing } = await supabase
        .from('visits')
        .select('id')
        .eq('id', existingVisitId)
        .eq('user_id', userId)
        .single();

      if (!existing) {
        return NextResponse.json({ error: 'Visit not found' }, { status: 404 });
      }

      const { error: updateError } = await supabase
        .from('visits')
        .update({ audio_path: audioPath, raw_text: rawText })
        .eq('id', existingVisitId);

      if (updateError) {
        return NextResponse.json({ error: 'Failed to update visit' }, { status: 500 });
      }

      // Remove old chunks before inserting new ones
      await supabase
        .from('transcript_chunks')
        .delete()
        .eq('visit_id', existingVisitId);

      visitId = existingVisitId;
    } else {
      // Create a new visit row
      const { data: visit, error: insertError } = await supabase
        .from('visits')
        .insert({
          user_id: userId,
          title,
          audio_path: audioPath,
          raw_text: rawText,
          language,
          visit_date: new Date().toISOString(),
          status: 'started',
        })
        .select('id')
        .single();

      if (insertError || !visit) {
        return NextResponse.json({ error: 'Failed to save visit' }, { status: 500 });
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
      .from('transcript_chunks')
      .insert(chunkRows);

    if (chunksError) {
      return NextResponse.json({ error: 'Failed to save visit chunks' }, { status: 500 });
    }

    const response: ProcessAudioResponse = {
      visitId,
      audioPath,
      chunkCount: chunks.length,
      transcriptText: rawText,
    };

    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
