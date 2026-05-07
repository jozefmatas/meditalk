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
  language: string;
  visit_date: string;
  patient_name: string | null;
  patient_id: string | null;
  visit_type: EncounterType;
  status: EncounterStatus;
  encounter_note: string | null;
  metadata: VisitMetadata;
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
  encounter_note?: string;
  metadata?: Record<string, unknown>;
}

// API response types
export interface EncounterListResponse {
  encounters: Encounter[];
  total: number;
  page: number;
  limit: number;
}

// Utility types
export type SupportedLanguage = "en" | "sk" | "cs";

// File metadata (stored in visits.metadata.files[] JSONB)
export type ExtractionStatus =
  | "pending"
  | "extracting"
  | "completed"
  | "failed";

export interface FileMetadata {
  id: string;
  name: string;
  size: number;
  type: string;
  path?: string;
  source?: string;
  extracted_text?: string | null;
  extraction_status?: ExtractionStatus | null;
  extraction_started_at?: string | null;
  extracted_at?: string | null;
  /**
   * Doctor's distillation directive for this file.
   * - Empty / missing → "Actual" mode: pipeline uses the WHOLE file as
   *   today's data (fresh ambulance vitals, ER readings, etc.).
   * - Non-empty → "Past" mode: pipeline runs a Haiku pre-filter and
   *   uses ONLY the passages matching the directive.
   */
  context?: string | null;
}

/**
 * Typed contract for `visits.metadata` JSONB column.
 *
 * All metadata keys are optional because the column starts as `{}` and
 * is populated incrementally by recording, upload, generation, and
 * feedback flows. The `& Record<string, unknown>` intersection preserves
 * backwards compat with code that still indexes by string.
 */
export interface VisitMetadata extends Record<string, unknown> {
  // ── Source material ──────────────────────────────────────────
  transcript?: string;
  doctor_notes?: string;
  files?: FileMetadata[];
  uploaded_files_context?: string;

  // ── Generation state ─────────────────────────────────────────
  template_id?: string;
  section_contents?: Record<string, string>;
  generation_pending?: {
    audioPath?: string;
    startedAt?: string;
  } | null;
  recording_session?: {
    state: "recording" | "paused";
    durationAtPause: number;
    audioPath?: string;
  } | null;

  // ── Analysis results ─────────────────────────────────────────
  clinical_analysis?: {
    suggestedIcdCodes?: Array<{
      code: string;
      label: string;
      certainty: string;
    }>;
  };

  // ── Caching ──────────────────────────────────────────────────
  file_focus_cache?: Record<
    string,
    {
      textHash: string;
      directive: string;
      output: string;
      classifiedPassages?: unknown;
    }
  >;
}

// Encounter list query params
export interface EncounterListParams {
  page?: number;
  limit?: number;
  status?: EncounterStatus;
  search?: string;
  sortBy?: "visit_date" | "created_at" | "patient_name";
  sortOrder?: "asc" | "desc";
}
