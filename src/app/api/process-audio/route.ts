import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { transcribeAudio, embedTexts } from '@/lib/openai';
import { chunkText } from '@/lib/chunking';
import type { ProcessAudioResponse, SupportedLanguage } from '@/lib/types';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const ALLOWED_AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/wav',
  'audio/webm',
  'audio/ogg',
  'audio/flac',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
]);

const VALID_LANGUAGES: SupportedLanguage[] = ['en', 'sk', 'cs'];

export async function POST(request: NextRequest) {
  try {
    const { userId, supabase } = await requireAuth();

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const title = (formData.get('title') as string) || null;
    const language = (formData.get('language') as string) || 'en';

    if (!file) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    // Browser may send "audio/webm;codecs=opus" — match base MIME type
    const baseMime = file.type.split(';')[0].trim();
    if (!ALLOWED_AUDIO_TYPES.has(baseMime)) {
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
      .from('audio')
      .upload(audioPath, file, { contentType: file.type });

    if (uploadError) {
      return NextResponse.json(
        { error: 'Failed to upload audio file' },
        { status: 500 }
      );
    }

    // Transcribe via Whisper
    const rawText = await transcribeAudio(file, file.name);

    // Insert visit row
    const { data: visit, error: insertError } = await supabase
      .from('visits')
      .insert({
        user_id: userId,
        title,
        audio_path: audioPath,
        raw_text: rawText,
        language,
        visit_date: new Date().toISOString(),
        status: 'draft',
      })
      .select('id')
      .single();

    if (insertError || !visit) {
      return NextResponse.json(
        { error: 'Failed to save visit' },
        { status: 500 }
      );
    }

    // Chunk and embed
    const chunks = chunkText(rawText);
    const embeddings = await embedTexts(chunks);

    // Insert chunks with embeddings
    const chunkRows = chunks.map((content, i) => ({
      visit_id: visit.id,
      chunk_index: i,
      content,
      embedding: JSON.stringify(embeddings[i]),
    }));

    const { error: chunksError } = await supabase
      .from('transcript_chunks')
      .insert(chunkRows);

    if (chunksError) {
      return NextResponse.json(
        { error: 'Failed to save visit chunks' },
        { status: 500 }
      );
    }

    const response: ProcessAudioResponse = {
      visitId: visit.id,
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
