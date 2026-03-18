// DB row types (matching supabase/migrations)

// Encounter types
export type EncounterStatus =
  | "started"
  | "recording"
  | "processing"
  | "to_review"
  | "completed"
  | "archived";
export type EncounterType =
  | "consultation"
  | "follow_up"
  | "preventive"
  | "acute"
  | "specialist_referral"
  | "telemedicine"
  | "home_visit";

export interface Encounter {
  id: string;
  user_id: string;
  title: string | null;
  audio_path: string | null;
  raw_text: string | null;
  language: string;
  visit_date: string;
  patient_name: string | null;
  patient_id: string | null;
  visit_type: EncounterType;
  status: EncounterStatus;
  soap_note: string | null;
  patient_letter: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface EncounterChunk {
  id: string;
  visit_id: string;
  chunk_index: number;
  content: string;
  embedding: number[] | null;
  created_at: string;
}

// Semantic search result (from match_chunks() RPC)
export interface ChunkMatch {
  id: string;
  visit_id: string;
  chunk_index: number;
  content: string;
  similarity: number;
}

// API request types
export interface CreateEncounterRequest {
  title?: string;
  patient_name?: string;
  patient_id?: string;
  visit_type?: EncounterType;
  visit_date?: string;
  language?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateEncounterRequest {
  title?: string;
  patient_name?: string;
  patient_id?: string;
  visit_type?: EncounterType;
  visit_date?: string;
  status?: EncounterStatus;
  language?: SupportedLanguage;
  soap_note?: string;
  patient_letter?: string;
  metadata?: Record<string, unknown>;
}

// API response types
export interface SearchResponse {
  matches: ChunkMatch[];
}

export interface GenerateResponse {
  generatedNote: string;
  letter: string;
  suggestedTitle?: string;
  usedChunks: string[];
  templateId: string;
  /** Clinical analysis results from Pass 1 */
  clinicalAnalysis?: {
    inferredSpecialty: string;
    secondarySpecialty?: string;
    candidateIcdCodes: Array<{
      code: string;
      description: string;
      confidence: string;
    }>;
    matchedConcepts: Array<{
      conceptId: string;
      canonicalName: string;
      confidence: string;
    }>;
    problemClusters: Array<{
      label: string;
      conceptIds: string[];
    }>;
  };
  /** @deprecated Use generatedNote instead */
  soap?: string;
}

export interface EncounterListResponse {
  encounters: Encounter[];
  total: number;
  page: number;
  limit: number;
}

// Utility types
export type SupportedLanguage = "en" | "sk" | "cs";

// Encounter list query params
export interface EncounterListParams {
  page?: number;
  limit?: number;
  status?: EncounterStatus;
  search?: string;
  sortBy?: "visit_date" | "created_at" | "patient_name";
  sortOrder?: "asc" | "desc";
}
