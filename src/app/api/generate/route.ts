import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { embedText } from '@/lib/openai';
import { generateSOAPAndLetter } from '@/lib/anthropic';
import type { GenerateResponse, SupportedLanguage } from '@/lib/types';

const RETRIEVAL_QUERY: Record<SupportedLanguage, string> = {
  en: 'Patient symptoms, diagnosis, examination findings, treatment plan, medications, follow-up',
  sk: 'Symptómy pacienta, diagnóza, vyšetrenie, plán liečby, lieky, kontrola',
  cs: 'Symptomy pacienta, diagnóza, vyšetření, plán léčby, léky, kontrola',
};

export async function POST(request: NextRequest) {
  try {
    const { supabase } = await requireAuth();

    const body = await request.json();
    const { transcriptId } = body as { transcriptId: string };

    if (!transcriptId) {
      return NextResponse.json(
        { error: 'Missing required field: transcriptId' },
        { status: 400 }
      );
    }

    // Fetch the transcript to get its language (RLS enforces ownership)
    const { data: transcript, error: txError } = await supabase
      .from('transcripts')
      .select('id, language')
      .eq('id', transcriptId)
      .single();

    if (txError || !transcript) {
      return NextResponse.json(
        { error: 'Transcript not found' },
        { status: 404 }
      );
    }

    const language = (transcript.language as SupportedLanguage) || 'en';

    // Embed a clinical retrieval query to find the most relevant chunks
    const queryEmbedding = await embedText(RETRIEVAL_QUERY[language]);

    const { data: matches, error: rpcError } = await supabase.rpc(
      'match_chunks',
      {
        query_embedding: JSON.stringify(queryEmbedding),
        match_count: 16,
        p_transcript_id: transcriptId,
      }
    );

    if (rpcError) {
      console.error('match_chunks RPC error:', rpcError);
      return NextResponse.json(
        { error: `Chunk retrieval failed: ${rpcError.message}` },
        { status: 500 }
      );
    }

    if (!matches || matches.length === 0) {
      return NextResponse.json(
        { error: 'No chunks found for this transcript' },
        { status: 404 }
      );
    }

    const chunkContents = matches.map(
      (m: { content: string }) => m.content
    );
    const usedChunks = matches.map(
      (m: { id: string }) => m.id as string
    );

    // Generate SOAP note and patient letter
    console.log('Calling Anthropic with', chunkContents.length, 'chunks, language:', language);
    let soap: string;
    let letter: string;
    try {
      const result = await generateSOAPAndLetter(chunkContents, language);
      soap = result.soap;
      letter = result.letter;
    } catch (anthropicErr) {
      console.error('Anthropic generation failed:', anthropicErr);
      return NextResponse.json(
        { error: `SOAP generation failed: ${anthropicErr instanceof Error ? anthropicErr.message : String(anthropicErr)}` },
        { status: 500 }
      );
    }

    const response: GenerateResponse = {
      soap,
      letter,
      usedChunks,
    };

    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('Generate route error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
