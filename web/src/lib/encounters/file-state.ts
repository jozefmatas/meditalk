/**
 * Pure file-state predicates and async utilities for encounter files.
 *
 * Extracted from `files-panel.tsx` so non-UI consumers
 * (`use-encounter-generation`, `adjust-drawer`, page.tsx) don't depend
 * on a `"use client"` component file.
 */

import type { FileMetadata } from "@/lib/types";
import { logger } from "@/lib/logger";

export interface EncounterFile extends FileMetadata {
  /** True if file is saved to IndexedDB but upload pending */
  pending?: boolean;
  /** True if recording is actively in progress (stops spinner when paused) */
  isRecording?: boolean;
}

// ─── Pending-context-save tracking ───────────────────────────────────

/**
 * Module-level tracking of pending file-context save PATCHes.
 * `handleGenerate` awaits these before calling `/api/generate` so the server
 * always reads the latest per-file directives from the database.
 */
export const pendingContextSaves = new Map<string, Promise<void>>();

/** Await (and clear) any in-flight file-context save for a visit. */
export function awaitPendingContextSave(
  visitId: string,
): Promise<void> | undefined {
  return pendingContextSaves.get(visitId);
}

// ─── Upload-state predicates ─────────────────────────────────────────

/**
 * Returns true if a file is currently being uploaded (shows a spinner in the UI).
 *
 * Live recording files (`source === "recording"`) are excluded because the
 * recording flow is a separate UX — the generate button explicitly supports
 * starting generation during an active recording.
 */
export function isFileUploading(file: EncounterFile): boolean {
  return !!file.pending && file.source !== "recording";
}

/** Returns true if any file in the list is currently uploading. */
export function hasUploadingFiles(files: EncounterFile[]): boolean {
  return files.some(isFileUploading);
}

// ─── Extraction-state predicates ─────────────────────────────────────

/**
 * True when a file's OCR / extraction hasn't landed yet. Uploaded (pending=false)
 * but `extracted_text` is still missing AND no failure was recorded. This is the
 * window between upload-success and extract-success where the file metadata
 * exists but the OCR hasn't run to completion. Generating in this window
 * silently drops the discharge letter's content from the prompt — exactly
 * the "first-gen bad / regenerate good" failure we observed in the wild.
 *
 * Recording-source files are excluded — their "extraction" is the live
 * transcript which travels a different path (metadata.transcript).
 */
export function isFileExtracting(file: EncounterFile): boolean {
  if (file.pending) return false; // covered by isFileUploading
  if (file.source === "recording") return false;
  if (file.extracted_text) return false;
  const status = file.extraction_status;
  if (status !== "pending" && status !== "extracting" && status !== undefined) {
    return false;
  }
  // Safety valve: if extraction has been running longer than the server's
  // stuck threshold (5 min), treat as unblocked so the user isn't wedged
  // forever when a worker dies. The server will reset + retry on the next
  // generate call.
  if (file.extraction_started_at) {
    const elapsedMs =
      Date.now() - new Date(file.extraction_started_at).getTime();
    if (elapsedMs > 5 * 60 * 1000) return false;
  }
  return true;
}

/** Returns true if any file is still waiting for OCR to land. */
export function hasExtractingFiles(files: EncounterFile[]): boolean {
  return files.some(isFileExtracting);
}

// ─── Extraction polling ──────────────────────────────────────────────

/**
 * Polls the encounter until all non-recording files have finished
 * extraction (or failed). Used by `handleGenerate` to wait for OCR to
 * land before calling `/api/generate`, so the pipeline always sees
 * the complete source material. The processing overlay is already
 * visible while this runs.
 *
 * Resolves immediately when no files are extracting.
 */
export async function awaitPendingExtractions(visitId: string): Promise<void> {
  const MAX_WAIT_MS = 120_000;
  const POLL_MS = 2_000;
  const start = Date.now();

  while (true) {
    const res = await fetch(`/api/encounters/${visitId}`);
    if (!res.ok) return; // can't check — proceed anyway

    const encounter = await res.json();
    const files = (encounter.metadata?.files ?? []) as EncounterFile[];
    if (!files.some(isFileExtracting)) return;

    if (Date.now() - start > MAX_WAIT_MS) {
      logger.warn(
        `[generate] awaitPendingExtractions: timed out after ${MAX_WAIT_MS}ms — proceeding with available data`,
      );
      return;
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
