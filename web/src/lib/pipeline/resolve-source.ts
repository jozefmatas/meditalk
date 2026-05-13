/**
 * Source resolver — extracts and normalises the raw encounter source
 * from a mix of client-provided data, stored audio blobs, and cached
 * file extractions.
 *
 * Absorbs:
 *   - Audio recovery (download + transcribe + concat)
 *   - Stuck extraction recovery
 *   - Extraction polling (wait for in-progress OCR)
 *   - Inline extraction fallback
 *   - PHI scrubbing
 *   - File-text assembly
 *   - Transcript merge from metadata fallback
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractFileText } from "@/lib/extraction/extract-file";
import { transcribeAudio } from "@/lib/elevenlabs";
import { scrubPhi } from "@/lib/phi-scrubber";
import { mergeVisitMetadata } from "@/lib/supabase/merge-metadata";
import { getTranscript } from "@/lib/encounters/sources";
import {
  EXTRACTION_STUCK_THRESHOLD_MS,
  EXTRACTION_WAIT_TIMEOUT_MS,
  EXTRACTION_POLL_INTERVAL_MS,
  TRANSCRIPT_WAIT_TIMEOUT_MS,
  TRANSCRIPT_POLL_INTERVAL_MS,
} from "@/lib/extraction/constants";
import type { RawSource } from "@/lib/sections/section-agent";
import type { SupportedLanguage, FileMetadata } from "@/lib/types";
import { logger } from "@/lib/logger";

// ── Public types ──────────────────────────────────────────────────

export interface ResolveSourceInput {
  supabase: SupabaseClient;
  userId: string;
  visitId: string;
  language: SupportedLanguage;
  /** Client-side real-time transcript (Scribe). */
  transcriptText?: string;
  /** Doctor's notes from the encounter. */
  doctorNotes?: string;
  /** Path to stored audio blob in Supabase storage (recovery). */
  audioPath?: string;
  visit: {
    metadata: Record<string, unknown>;
    patient_name?: string | null;
    patient_id?: string | null;
  };
}

export interface ResolvedSource {
  /** Ready for the pipeline (transcript + doctorNotes + files). */
  rawSource: RawSource;
  /** PHI-scrubbed transcript text (for persistence). */
  transcriptText?: string;
  /** PHI-scrubbed doctor notes (for persistence). */
  doctorNotes?: string;
  /** Extracted file texts with ids (for file-focus filter). */
  fileTexts: Array<{
    id: string;
    name: string;
    type: string;
    text: string;
    context?: string;
  }>;
  /** Total PHI redactions applied across all sources. */
  phiRedactionCount: number;
  /** Refreshed metadata after extraction (for downstream persistence). */
  refreshedMetadata: Record<string, unknown>;
}

// ── Implementation ────────────────────────────────────────────────

const RECOVERY_MAX_RETRIES = 2; // 3 attempts total

export async function resolveSource(
  input: ResolveSourceInput,
): Promise<ResolvedSource> {
  const { supabase, userId, visitId, language, visit } = input;
  let transcriptText = input.transcriptText;
  let doctorNotes = input.doctorNotes;
  const clientAudioPath = input.audioPath;

  const visitMeta = visit.metadata;
  const patientName =
    typeof visit.patient_name === "string" ? visit.patient_name : undefined;
  const patientId =
    typeof visit.patient_id === "string" ? visit.patient_id : undefined;

  // ── 0. Server-side transcript polling ─────────────────────────
  // When a recording_session.snapshotVersion exists and no client
  // transcript was provided, check if the in-flight pause-time
  // transcription has landed in metadata. This avoids re-downloading
  // and re-transcribing the same audio blob.
  if (!transcriptText) {
    const session = visitMeta.recording_session as
      | { snapshotVersion?: number }
      | undefined;
    if (typeof session?.snapshotVersion === "number") {
      const { transcript } = await waitForTranscript(
        supabase,
        visitId,
        session.snapshotVersion,
      );
      if (transcript) {
        transcriptText = transcript;
        logger.debug(
          `[resolve-source] Using polled transcript (${transcript.length} chars) — skipping audio recovery`,
        );
      }
    }
  }

  // ── 1. Audio recovery ──────────────────────────────────────────
  const effectiveAudioPath = resolveAudioPath(clientAudioPath, visitMeta);

  // Only enter recovery when audio exists but NO transcript was provided.
  // When the client sends transcriptText (e.g. from a pause-snapshot match),
  // skip the expensive download + re-transcription entirely.
  if (effectiveAudioPath && !transcriptText) {
    logger.debug(
      `[resolve-source] Recovery audio — client: ${clientAudioPath || "NONE"}, effective: ${effectiveAudioPath}`,
    );
    transcriptText = await recoverAudioTranscript(
      supabase,
      effectiveAudioPath,
      language,
      userId,
      visitId,
      transcriptText,
    );
  } else if (effectiveAudioPath && transcriptText) {
    logger.debug(
      `[resolve-source] Skipping recovery — transcript already provided (${transcriptText.length} chars)`,
    );
  }

  // Fallback: use metadata.transcript when client-side transcription failed
  if (!transcriptText) {
    const existing = getTranscript(visitMeta);
    if (existing) {
      transcriptText = existing;
      logger.debug(
        `[resolve-source] Using metadata.transcript fallback: ${transcriptText.length} chars`,
      );
    }
  }

  // ── 2. File extraction ─────────────────────────────────────────
  let uploadedFiles = (visitMeta.files ?? []) as FileMetadata[];

  // 2a. Reset stuck extractions
  await resetStuckExtractions(supabase, visitId, uploadedFiles);

  // 2b. Wait for in-progress extractions
  uploadedFiles = await waitForExtractions(supabase, visitId, uploadedFiles);

  // 2c. Inline extraction for unprocessed files
  await extractUnprocessedFiles(
    supabase,
    userId,
    visitId,
    language,
    uploadedFiles,
    transcriptText,
  );

  // Persist recording transcript to metadata (for ResourcesPanel)
  const recordingText = uploadedFiles.find(
    (f) => f.source === "recording" && f.extracted_text,
  )?.extracted_text;
  if (recordingText) {
    await mergeVisitMetadata(supabase, visitId, {
      transcript: recordingText,
    });
  }

  // 2d. Build fileTexts — exclude recording files when transcriptText
  // is present (avoids double transcript in generated sources)
  const fileTexts = uploadedFiles
    .filter(
      (f) => f.extracted_text && !(transcriptText && f.source === "recording"),
    )
    .map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      text: f.extracted_text!,
      context: f.context || undefined,
    }));

  // Persist transcript to metadata for ResourcesPanel display
  if (transcriptText) {
    await mergeVisitMetadata(supabase, visitId, {
      transcript: transcriptText,
    });
  }

  // ── 3. PHI scrub ──────────────────────────────────────────────
  let phiRedactionCount = 0;
  if (transcriptText) {
    const r = scrubPhi(transcriptText, patientName, patientId);
    transcriptText = r.scrubbed;
    phiRedactionCount += r.audit.totalRedactions;
  }
  for (const ft of fileTexts) {
    const r = scrubPhi(ft.text, patientName, patientId);
    ft.text = r.scrubbed;
    phiRedactionCount += r.audit.totalRedactions;
  }
  if (doctorNotes) {
    const r = scrubPhi(doctorNotes, patientName, patientId);
    doctorNotes = r.scrubbed;
    phiRedactionCount += r.audit.totalRedactions;
  }
  if (phiRedactionCount > 0) {
    logger.info(
      `[resolve-source] PHI scrub: ${phiRedactionCount} redaction(s) applied`,
    );
  }

  // ── 4. Re-read metadata after extraction ──────────────────────
  const { data: refreshedVisit } = await supabase
    .from("visits")
    .select("metadata")
    .eq("id", visitId)
    .single();
  const refreshedMetadata =
    (refreshedVisit?.metadata as Record<string, unknown>) || visitMeta;

  // ── 5. Build raw source ───────────────────────────────────────
  const rawSource: RawSource = {
    transcript: transcriptText?.trim() || undefined,
    doctorNotes: doctorNotes?.trim() || undefined,
    files: fileTexts.map((f) => ({
      name: f.name,
      text: f.text,
      context: f.context,
    })),
  };

  return {
    rawSource,
    transcriptText,
    doctorNotes,
    fileTexts,
    phiRedactionCount,
    refreshedMetadata,
  };
}

// ── Private helpers ───────────────────────────────────────────────

function resolveAudioPath(
  clientAudioPath: string | undefined,
  visitMeta: Record<string, unknown>,
): string | undefined {
  const sessionAudioPath = (
    visitMeta.recording_session as { audioPath?: string } | undefined
  )?.audioPath;
  const pendingAudioPath = (
    visitMeta.generation_pending as { audioPath?: string } | undefined
  )?.audioPath;
  return clientAudioPath || pendingAudioPath || sessionAudioPath;
}

async function recoverAudioTranscript(
  supabase: SupabaseClient,
  audioPath: string,
  language: SupportedLanguage,
  userId: string,
  visitId: string,
  existingTranscript: string | undefined,
): Promise<string | undefined> {
  let transcriptText = existingTranscript;

  for (let attempt = 0; attempt <= RECOVERY_MAX_RETRIES; attempt++) {
    try {
      const { data: audioData, error: dlError } = await supabase.storage
        .from("encounter-files")
        .download(audioPath);

      if (dlError || !audioData) {
        logger.error(
          `[resolve-source] Failed to download recovery audio (attempt ${attempt + 1}/${RECOVERY_MAX_RETRIES + 1}):`,
          dlError,
        );
        if (attempt < RECOVERY_MAX_RETRIES) {
          await sleep(3000 * (attempt + 1));
          continue;
        }
        break;
      }

      const ext = audioPath.substring(audioPath.lastIndexOf("."));
      const mimeMap: Record<string, string> = {
        ".webm": "audio/webm",
        ".ogg": "audio/ogg",
        ".m4a": "audio/mp4",
        ".mp4": "audio/mp4",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".flac": "audio/flac",
      };
      // Build File directly from Blob — avoids Blob→ArrayBuffer→Buffer copy.
      const audioFile = new File([audioData], `recovery${ext}`, {
        type: mimeMap[ext] || "audio/mpeg",
      });
      logger.debug(
        `[resolve-source] Recovery audio downloaded: ${audioFile.size} bytes`,
      );
      const recovered = await transcribeAudio(
        audioFile,
        `recovery${ext}`,
        language,
        { userId, visitId },
      );
      if (recovered) {
        transcriptText = transcriptText
          ? `${recovered}\n\n${transcriptText}`
          : recovered;
        logger.debug(
          `[resolve-source] Recovery transcription: ${recovered.length} chars (total: ${transcriptText.length} chars)`,
        );
      } else {
        logger.warn(
          `[resolve-source] Recovery transcription returned empty text (attempt ${attempt + 1}/${RECOVERY_MAX_RETRIES + 1})`,
        );
        if (attempt < RECOVERY_MAX_RETRIES) {
          await sleep(3000 * (attempt + 1));
          continue;
        }
      }
      break;
    } catch (err) {
      logger.warn(
        `[resolve-source] Recovery audio transcription failed (attempt ${attempt + 1}/${RECOVERY_MAX_RETRIES + 1}):`,
        err,
      );
      if (attempt < RECOVERY_MAX_RETRIES) {
        await sleep(3000 * (attempt + 1));
        continue;
      }
    }
  }

  return transcriptText;
}

async function resetStuckExtractions(
  supabase: SupabaseClient,
  visitId: string,
  files: FileMetadata[],
): Promise<void> {
  const now = Date.now();
  for (const file of files) {
    if (file.extraction_status !== "extracting") continue;
    if (!file.extraction_started_at) continue;
    const elapsed = now - new Date(file.extraction_started_at).getTime();
    if (elapsed > EXTRACTION_STUCK_THRESHOLD_MS) {
      logger.warn(
        `[resolve-source] Resetting stuck extraction: file=${file.id} name=${file.name} elapsed=${Math.round(elapsed / 1000)}s`,
      );
      await supabase.rpc("update_file_extraction_status", {
        p_visit_id: visitId,
        p_file_id: file.id,
        p_status: "failed",
      });
      file.extraction_status = "failed";
      file.extraction_started_at = null;
    }
  }
}

async function waitForExtractions(
  supabase: SupabaseClient,
  visitId: string,
  uploadedFiles: FileMetadata[],
): Promise<FileMetadata[]> {
  const pendingIds = new Set(
    uploadedFiles.filter((f) => f.path && !f.extracted_text).map((f) => f.id),
  );

  if (pendingIds.size === 0) return uploadedFiles;

  logger.debug(
    `[resolve-source] Waiting for ${pendingIds.size} extraction(s): ${uploadedFiles
      .filter((f) => pendingIds.has(f.id))
      .map((f) => `${f.name} [${f.extraction_status ?? "no-status"}]`)
      .join(", ")}`,
  );
  const pollStart = Date.now();
  let files = uploadedFiles;

  while (Date.now() - pollStart < EXTRACTION_WAIT_TIMEOUT_MS) {
    await sleep(EXTRACTION_POLL_INTERVAL_MS);
    const { data: refreshed } = await supabase
      .from("visits")
      .select("metadata")
      .eq("id", visitId)
      .single();
    if (!refreshed) break;

    const meta = (refreshed.metadata ?? {}) as Record<string, unknown>;
    files = (meta.files ?? []) as FileMetadata[];

    const stillPending = files.filter(
      (f) =>
        pendingIds.has(f.id) &&
        !f.extracted_text &&
        f.extraction_status !== "failed",
    );
    if (stillPending.length === 0) break;
  }

  const completed = files.filter(
    (f) => pendingIds.has(f.id) && f.extracted_text,
  ).length;
  const failed = files.filter(
    (f) => pendingIds.has(f.id) && f.extraction_status === "failed",
  ).length;
  logger.debug(
    `[resolve-source] Extraction wait done (${Date.now() - pollStart}ms): ${completed} completed, ${failed} failed out of ${pendingIds.size}`,
  );

  return files;
}

async function extractUnprocessedFiles(
  supabase: SupabaseClient,
  userId: string,
  visitId: string,
  language: SupportedLanguage,
  uploadedFiles: FileMetadata[],
  transcriptText: string | undefined,
): Promise<void> {
  const unprocessed = uploadedFiles.filter((f) => !f.extracted_text && f.path);
  if (unprocessed.length === 0) return;

  const retrying = unprocessed.filter((f) => f.extraction_status === "failed");
  const stuck = unprocessed.filter(
    (f) =>
      f.extraction_status === "extracting" || f.extraction_status === "pending",
  );
  const legacy = unprocessed.filter((f) => !f.extraction_status);
  logger.debug(
    `[resolve-source] Extracting ${unprocessed.length} file(s) inline: ${retrying.length} retrying, ${stuck.length} stuck-after-poll, ${legacy.length} legacy`,
  );

  await Promise.all(
    unprocessed.map(async (file) => {
      try {
        const result = await extractFileText({
          file: { ...file, path: file.path! },
          supabase,
          userId,
          visitId,
          language,
          ...(file.type.startsWith("audio/") && { transcriptText }),
        });
        file.extracted_text = result.text;
        logger.debug(
          `[resolve-source] Extracted ${result.text.length} chars from ${file.name} in ${result.elapsedMs}ms`,
        );
      } catch (err) {
        logger.error(
          `[resolve-source] Extraction failed for ${file.name}:`,
          err,
        );
      }
    }),
  );
}

// ── Transcript polling ────────────────────────────────────────────

export interface TranscriptPollResult {
  /** The transcript text if found, undefined if polling timed out. */
  transcript: string | undefined;
  /** Whether we obtained the transcript from polling (true) or it was already there (false). */
  polled: boolean;
}

/**
 * Poll for an in-flight pause-time transcript to land in metadata.
 *
 * Similar to `waitForExtractions` — polls the DB for
 * `transcriptSnapshotVersion` matching the given `snapshotVersion`.
 */
export async function waitForTranscript(
  supabase: SupabaseClient,
  visitId: string,
  snapshotVersion: number,
): Promise<TranscriptPollResult> {
  // Immediate check — transcript may already be there
  const initialMeta = await fetchVisitMetadata(supabase, visitId);
  const initialTranscript = checkTranscriptReady(initialMeta, snapshotVersion);
  if (initialTranscript) {
    return { transcript: initialTranscript, polled: false };
  }

  // Poll for in-flight transcript
  logger.debug(
    `[resolve-source] Waiting for transcript (snapshotVersion: ${snapshotVersion})`,
  );
  const pollStart = Date.now();
  while (Date.now() - pollStart < TRANSCRIPT_WAIT_TIMEOUT_MS) {
    await sleep(TRANSCRIPT_POLL_INTERVAL_MS);
    const meta = await fetchVisitMetadata(supabase, visitId);
    const transcript = checkTranscriptReady(meta, snapshotVersion);
    if (transcript) {
      logger.debug(
        `[resolve-source] Transcript arrived after ${Date.now() - pollStart}ms polling (${transcript.length} chars)`,
      );
      return { transcript, polled: true };
    }
  }

  logger.debug(
    `[resolve-source] Transcript polling timed out after ${TRANSCRIPT_WAIT_TIMEOUT_MS}ms`,
  );
  return { transcript: undefined, polled: false };
}

function checkTranscriptReady(
  meta: Record<string, unknown>,
  snapshotVersion: number,
): string | undefined {
  const transcriptVersion = meta?.transcriptSnapshotVersion as
    | number
    | undefined;
  if (
    typeof transcriptVersion !== "number" ||
    transcriptVersion !== snapshotVersion
  ) {
    return undefined;
  }
  const transcript = meta?.transcript;
  return typeof transcript === "string" && transcript.length > 0
    ? transcript
    : undefined;
}

async function fetchVisitMetadata(
  supabase: SupabaseClient,
  visitId: string,
): Promise<Record<string, unknown>> {
  const { data } = await supabase
    .from("visits")
    .select("metadata")
    .eq("id", visitId)
    .single();
  return (data?.metadata ?? {}) as Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
