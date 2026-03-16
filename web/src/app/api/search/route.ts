import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { embedText } from "@/lib/openai";
import type { SearchResponse } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const { supabase } = await requireAuth();

    const body = await request.json();
    // Support both visitId (new) and transcriptId (legacy)
    const visitId = body.visitId || body.transcriptId;
    const { query, k = 10 } = body as {
      query: string;
      k?: number;
    };

    if (!query || !visitId) {
      return NextResponse.json(
        { error: "Missing required fields: query, visitId" },
        { status: 400 },
      );
    }

    // Verify visit belongs to user (RLS handles this, but check existence)
    const { data: visit, error: visitError } = await supabase
      .from("visits")
      .select("id")
      .eq("id", visitId)
      .single();

    if (visitError || !visit) {
      return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    }

    // Embed the search query
    const queryEmbedding = await embedText(query);

    // Semantic search via match_chunks RPC
    const { data: matches, error: rpcError } = await supabase.rpc(
      "match_chunks",
      {
        query_embedding: JSON.stringify(queryEmbedding),
        match_count: k,
        p_visit_id: visitId,
      },
    );

    if (rpcError) {
      console.error("match_chunks RPC error:", rpcError);
      return NextResponse.json(
        { error: `Search failed: ${rpcError.message}` },
        { status: 500 },
      );
    }

    const response: SearchResponse = {
      matches: matches ?? [],
    };

    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Search route error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
