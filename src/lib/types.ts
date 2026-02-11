// DB row types (matching supabase/migrations/001_initial_schema.sql)

export interface Transcript {
  id: string;
  user_id: string;
  title: string | null;
  audio_path: string | null;
  raw_text: string | null;
  language: string;
  created_at: string;
}

export interface TranscriptChunk {
  id: string;
  transcript_id: string;
  chunk_index: number;
  content: string;
  embedding: number[] | null;
  created_at: string;
}

// Semantic search result (from match_chunks() RPC)
export interface ChunkMatch {
  id: string;
  transcript_id: string;
  chunk_index: number;
  content: string;
  similarity: number;
}

// API response types
export interface ProcessAudioResponse {
  transcriptId: string;
  audioPath: string;
  chunkCount: number;
  transcriptText: string;
}

export interface SearchResponse {
  matches: ChunkMatch[];
}

export interface GenerateResponse {
  soap: string;
  letter: string;
  usedChunks: string[];
}

// Utility
export type SupportedLanguage = 'en' | 'sk' | 'cs';
