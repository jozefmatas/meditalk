import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { embedText } from '@/lib/openai';
import type { SearchResponse } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const { supabase } = await requireAuth();

    const body = await request.json();
    const { query, transcriptId, k = 10 } = body as {
      query: string;
      transcriptId: string;
      k?: number;
    };

    if (!query || !transcriptId) {
      return NextResponse.json(
        { error: 'Missing required fields: query, transcriptId' },
        { status: 400 }
      );
    }

    // Verify transcript belongs to user (RLS handles this, but check existence)
    const { data: transcript, error: txError } = await supabase
      .from('transcripts')
      .select('id')
      .eq('id', transcriptId)
      .single();

    if (txError || !transcript) {
      return NextResponse.json(
        { error: 'Transcript not found' },
        { status: 404 }
      );
    }

    // Embed the search query
    const queryEmbedding = await embedText(query);

    // Semantic search via match_chunks RPC
    const { data: matches, error: rpcError } = await supabase.rpc(
      'match_chunks',
      {
        query_embedding: JSON.stringify(queryEmbedding),
        match_count: k,
        p_transcript_id: transcriptId,
      }
    );

    if (rpcError) {
      return NextResponse.json(
        { error: 'Search failed' },
        { status: 500 }
      );
    }

    const response: SearchResponse = {
      matches: matches ?? [],
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
