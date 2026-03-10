// DB row types (matching supabase/migrations)

// Visit types
export type VisitStatus = 'draft' | 'recording' | 'processing' | 'review' | 'closed' | 'archived';
export type VisitType =
  | 'consultation'
  | 'follow_up'
  | 'preventive'
  | 'acute'
  | 'specialist_referral'
  | 'telemedicine'
  | 'home_visit';

export interface Visit {
  id: string;
  user_id: string;
  title: string | null;
  audio_path: string | null;
  raw_text: string | null;
  language: string;
  visit_date: string;
  patient_name: string | null;
  patient_id: string | null;
  visit_type: VisitType;
  status: VisitStatus;
  soap_note: string | null;
  patient_letter: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// Legacy alias for backward compatibility with existing code
export type Transcript = Visit;

export interface VisitChunk {
  id: string;
  visit_id: string;
  chunk_index: number;
  content: string;
  embedding: number[] | null;
  created_at: string;
}

// Legacy alias
export type TranscriptChunk = VisitChunk;

// Semantic search result (from match_chunks() RPC)
export interface ChunkMatch {
  id: string;
  visit_id: string;
  chunk_index: number;
  content: string;
  similarity: number;
}

// API request types
export interface CreateVisitRequest {
  title?: string;
  patient_name?: string;
  patient_id?: string;
  visit_type?: VisitType;
  visit_date?: string;
  language?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateVisitRequest {
  title?: string;
  patient_name?: string;
  patient_id?: string;
  visit_type?: VisitType;
  visit_date?: string;
  status?: VisitStatus;
  soap_note?: string;
  patient_letter?: string;
  metadata?: Record<string, unknown>;
}

// API response types
export interface ProcessAudioResponse {
  visitId: string;
  audioPath: string;
  chunkCount: number;
  transcriptText: string;
}

// Legacy alias
export type { ProcessAudioResponse as TranscriptResponse };

export interface SearchResponse {
  matches: ChunkMatch[];
}

export interface GenerateResponse {
  generatedNote: string;
  letter: string;
  usedChunks: string[];
  templateId: string;
  /** @deprecated Use generatedNote instead */
  soap?: string;
}

export interface VisitListResponse {
  visits: Visit[];
  total: number;
  page: number;
  limit: number;
}

// Utility types
export type SupportedLanguage = 'en' | 'sk' | 'cs';

// Visit list query params
export interface VisitListParams {
  page?: number;
  limit?: number;
  status?: VisitStatus;
  search?: string;
  sortBy?: 'visit_date' | 'created_at' | 'patient_name';
  sortOrder?: 'asc' | 'desc';
}
