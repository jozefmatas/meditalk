"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { Encounter, SupportedLanguage } from "@/lib/types";
import type { EncounterFile } from "@/components/encounters/files-panel";
import { type RecordingBarRef } from "@/components/encounters/recording-bar";
import type { NoteSection } from "@/lib/parse-note-sections";
import {
  DEFAULT_TEMPLATE_ID,
  getPreferredTemplateId,
  setPreferredTemplateId,
} from "@/lib/templates";
import { useGenerationTimer } from "@/hooks/use-generation-timer";
import { parseSSEStream } from "@/lib/api/parse-sse-stream";
import { useTemplateCache } from "./use-template-cache";
import { useGenerationPolling } from "./use-generation-polling";
import { transcribeBlob } from "./transcribe-blob";
import { uploadToStorage } from "@/lib/supabase/upload";
import { audioMimeToExt } from "./use-audio-recorder";
import { getTranscript } from "@/lib/encounters/sources";
import { useSaveStatus } from "@/hooks/use-save-status";
import { logger } from "@/lib/logger";

/** Module-level tracking of active generations so they survive component remounts. */
const activeGenerations = new Set<string>();

const CLIENT_MAX_RETRIES = 2;
const CLIENT_RETRY_DELAY = 3000;

/** Classify whether an error is transient (worth retrying) or permanent. */
function isTransientError(err: unknown, status?: number): boolean {
  if (err instanceof TypeError) return true; // Network failure
  if (status && [408, 429, 502, 503, 504].includes(status)) return true;
  if (
    err instanceof Error &&
    /network|aborted|failed to fetch/i.test(err.message)
  )
    return true;
  return false;
}

interface UseEncounterGenerationOptions {
  visitId: string;
  visit: Encounter | null;
  setVisit: React.Dispatch<React.SetStateAction<Encounter | null>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  updateTitle: (newTitle: string) => void;
  setFiles: (
    update: EncounterFile[] | ((prev: EncounterFile[]) => EncounterFile[]),
  ) => void;
}

export function useEncounterGeneration({
  visitId,
  visit,
  setVisit,
  setError,
  updateTitle,
  setFiles,
}: UseEncounterGenerationOptions) {
  // Generation language
  const [generationLanguage, setGenerationLanguage] =
    useState<SupportedLanguage>("sk");

  // Template + generation (reads last-used template from localStorage)
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    getPreferredTemplateId,
  );
  const [doctorNotes, setDoctorNotes] = useState("");
  const [generatedNoteHtml, setGeneratedNoteHtml] = useState("");
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  // Tracks the full generation lifecycle — from the moment handleGenerate /
  // handleAdjustGenerate is invoked until the finally block runs. Used by the
  // page to keep the processing overlay visible during the pre-streaming
  // window, so the UI never falls back to DraftView even if visit.status gets
  // transiently reset by a stray event or stale poll response.
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamedSections, setStreamedSections] = useState<NoteSection[]>([]);
  // Template section IDs received from streaming_start — used for skeleton rendering
  const [streamingSectionIds, setStreamingSectionIds] = useState<string[]>([]);
  const [streamingSectionLabels, setStreamingSectionLabels] = useState<
    Record<string, string>
  >({});

  // Audio recording — blob kept in memory for canGenerate check
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [hasActiveRecording, setHasActiveRecording] = useState(false);
  const recordingBarRef = useRef<RecordingBarRef>(null);

  const initialDoctorNotesRef = useRef("");
  const saveStatus = useSaveStatus();

  // Client-side cache: templateId → { generatedNote, letter }
  const { getCachedTemplate, setCachedTemplate, clearCache } =
    useTemplateCache();

  // Stable refs for callbacks
  const updateTitleRef = useRef(updateTitle);
  updateTitleRef.current = updateTitle;

  // We need access to current title for handleGenerate without adding it as dependency
  const titleRef = useRef("");
  /** Keep titleRef in sync — call this from page when title changes */
  const syncTitle = useCallback((t: string) => {
    titleRef.current = t;
  }, []);

  // Auto-save doctor notes (2s debounce) with save-status feedback + single retry.
  useEffect(() => {
    if (!visit || doctorNotes === initialDoctorNotesRef.current) return;

    const timeout = setTimeout(async () => {
      saveStatus.markSaving();

      const doSave = async () => {
        const res = await fetch(`/api/encounters/${visitId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            metadata: { doctor_notes: doctorNotes },
          }),
        });
        if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      };

      try {
        await doSave();
        initialDoctorNotesRef.current = doctorNotes;
        saveStatus.markSaved();
      } catch {
        // Single retry after 3 s
        try {
          await new Promise((r) => setTimeout(r, 3000));
          await doSave();
          initialDoctorNotesRef.current = doctorNotes;
          saveStatus.markSaved();
        } catch {
          saveStatus.markError();
        }
      }
    }, 2000);

    return () => clearTimeout(timeout);
  }, [doctorNotes, visit, visitId, saveStatus]);

  const handleRecordingStateChange = useCallback(
    (recordingState: "idle" | "recording" | "paused") => {
      setHasActiveRecording(recordingState !== "idle");

      // Update pending recording file's isRecording flag for dynamic spinner
      setFiles((prev: EncounterFile[]) =>
        prev.map((f) =>
          f.source === "recording" && f.pending
            ? { ...f, isRecording: recordingState === "recording" }
            : f,
        ),
      );

      // Don't override status during generation — finalize() triggers an "idle"
      // state change that would overwrite "processing" and break the UI flow.
      if (activeGenerations.has(visitId)) return;
      const status = recordingState === "recording" ? "recording" : "started";
      setVisit((prev) => (prev ? { ...prev, status } : prev));
      window.dispatchEvent(
        new CustomEvent("encounter-update", {
          detail: { id: visitId, status },
        }),
      );
      // Persist to DB (fire-and-forget)
      fetch(`/api/encounters/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).catch(() => {});
    },
    [visitId, setVisit, setFiles],
  );

  const handleGenerate = useCallback(
    async (options?: { sendAsEmail?: boolean }) => {
      if (!visitId || activeGenerations.has(visitId)) return;
      activeGenerations.add(visitId);
      setIsGenerating(true);
      setIsStreaming(false);

      setStreamedSections([]);
      setStreamingSectionIds([]);
      setStreamingSectionLabels({});
      setError(null);

      // Capture values at call time so the chain works even after unmount
      const capturedTemplateId = selectedTemplateId;
      const capturedDoctorNotes = doctorNotes;
      const capturedTitle = titleRef.current;

      // Finalize BEFORE setting processing status — setVisit(processing) causes
      // DraftView to unmount (swaps to ProcessingView), which destroys RecordingBar
      // and nulls recordingBarRef. We need the ref alive to collect the blob.
      const finalized = await recordingBarRef.current?.finalize();
      const blobToProcess = finalized?.blob ?? audioBlob;
      const isRestoredSession = finalized?.isRestoredSession ?? false;

      // Now safe to switch to processing UI
      setVisit((prev) => (prev ? { ...prev, status: "processing" } : prev));
      window.dispatchEvent(
        new CustomEvent("encounter-update", {
          detail: { id: visitId, status: "processing" },
        }),
      );

      // Persist generation intent BEFORE transcription.
      // This ensures that if the app is killed (e.g. Android background), we can
      // auto-resume generation on page reload using the stored audio blob.
      await fetch(`/api/encounters/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "processing",
          metadata: {
            generation_pending: {
              templateId: capturedTemplateId,
              doctorNotes: capturedDoctorNotes || undefined,
            },
          },
        }),
      }).catch(() => {});

      logger.debug(
        `[generate] Finalized — blob: ${blobToProcess?.size || 0} bytes`,
      );

      // Upload blob to Supabase storage for recovery if app is killed/closed.
      // Runs in parallel with transcription — upload is fast (just bytes),
      // transcription is the slow path (20-60s via ElevenLabs).
      const uploadPromise = blobToProcess
        ? (async () => {
            try {
              const ext = audioMimeToExt(blobToProcess.type);
              const fileName = `recovery${ext}`;
              const { path } = await uploadToStorage(
                new File([blobToProcess], fileName, {
                  type: blobToProcess.type,
                }),
                fileName,
                { encounterId: visitId },
              );
              // Persist audioPath so auto-resume can find it after app kill
              fetch(`/api/encounters/${visitId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  metadata: {
                    generation_pending: {
                      templateId: capturedTemplateId,
                      doctorNotes: capturedDoctorNotes || undefined,
                      audioPath: path,
                    },
                  },
                }),
              }).catch(() => {});
              logger.debug(`[generate] Recovery blob uploaded: ${path}`);
              return path;
            } catch (err) {
              logger.warn("[generate] Recovery blob upload failed:", err);
              return null;
            }
          })()
        : Promise.resolve(null);

      // Full-blob transcription gives the best quality — the transcriber
      // has full conversational context in one pass. When no blob is available
      // (e.g. restored session after navigate-away), fall back to
      // metadata.transcript which was set during pause-time transcription,
      // or let the server use the audioPath from recording_session /
      // generation_pending metadata.
      const finalTranscript = blobToProcess
        ? await transcribeBlob(blobToProcess, generationLanguage, visitId)
        : getTranscript(visit?.metadata as Record<string, unknown>);

      // Wait for recovery upload (usually completes during transcription)
      await uploadPromise;

      // Determine audioPath for server-side recovery/concatenation:
      // - No blob in memory: server downloads from generation_pending or recording_session
      // - Restored session (resumed after page refresh): prior recording's audioPath
      //   from recording_session — server transcribes it and prepends to finalTranscript
      const meta = (visit?.metadata ?? {}) as Record<string, unknown>;
      const pendingMeta = meta?.generation_pending as
        | { audioPath?: string }
        | undefined;
      const sessionMeta = meta?.recording_session as
        | { audioPath?: string }
        | undefined;

      let audioRecoveryPath: string | undefined;
      if (!blobToProcess) {
        // No blob at all — full recovery from server
        audioRecoveryPath =
          pendingMeta?.audioPath || sessionMeta?.audioPath || undefined;
      } else if (isRestoredSession && sessionMeta?.audioPath) {
        // Restored session: prior recording blob + new recording blob.
        // Send prior audioPath so server transcribes and prepends it.
        audioRecoveryPath = sessionMeta.audioPath;
      }

      try {
        setAudioBlob(null);

        // Generate note via SSE streaming (with client-side retry for transient errors)
        // Mutable container — TypeScript can't track assignments inside async callbacks
        const ctx = {
          completedEvent: null as Record<string, unknown> | null,
          streamingStarted: false,
        };

        for (let attempt = 0; attempt <= CLIENT_MAX_RETRIES; attempt++) {
          if (attempt > 0) {
            logger.warn(
              `[generate] Client retry ${attempt}/${CLIENT_MAX_RETRIES}`,
            );
            await new Promise((r) => setTimeout(r, CLIENT_RETRY_DELAY));
            setIsStreaming(false);
            setStreamedSections([]);
            setStreamingSectionIds([]);
            setStreamingSectionLabels({});
          }

          try {
            const res = await fetch("/api/generate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                visitId,
                templateId: capturedTemplateId,
                doctorNotes: capturedDoctorNotes || undefined,
                transcriptText: finalTranscript || undefined,
                audioPath: audioRecoveryPath || undefined,
                sendAsEmail: options?.sendAsEmail || false,
              }),
            });

            if (!res.ok) {
              let message = "generation_failed";
              try {
                const data = await res.json();
                message = data.error || message;
              } catch {
                /* non-JSON response */
              }
              const err = new Error(message);
              if (
                isTransientError(null, res.status) &&
                attempt < CLIENT_MAX_RETRIES
              )
                continue;
              throw err;
            }

            // Read SSE stream
            if (!res.body) throw new Error("generation_failed");

            await parseSSEStream(res.body, {
              onStreamingStart: (e) => {
                ctx.streamingStarted = true;
                setIsStreaming(true);
                setStreamedSections([]);
                setStreamingSectionIds(e.sectionIds);
                setStreamingSectionLabels(e.sectionLabels);
              },
              onSection: (e) => {
                setStreamedSections((prev) => [
                  ...prev,
                  { id: e.id, title: e.title, content: e.content },
                ]);
              },
              onComplete: (event) => {
                ctx.completedEvent = event;
                setCachedTemplate(capturedTemplateId, {
                  generatedNote: event.generatedNote as string,
                  letter: (event.letter as string) || "",
                });
                setGeneratedNoteHtml(event.generatedNote as string);

                const autoTitle = !capturedTitle.trim()
                  ? (event.suggestedTitle as string)
                  : null;

                setVisit((prev) => {
                  if (!prev) return prev;
                  const existingMeta = (prev.metadata ?? {}) as Record<
                    string,
                    unknown
                  >;
                  return {
                    ...prev,
                    encounter_note: event.generatedNote as string,
                    patient_letter: event.letter as string,
                    status: "to_review",
                    ...(autoTitle ? { title: autoTitle } : {}),
                    metadata: {
                      ...existingMeta,
                      ...(finalTranscript
                        ? { transcript: finalTranscript }
                        : {}),
                      ...(event.clinicalAnalysis
                        ? { clinical_analysis: event.clinicalAnalysis }
                        : {}),
                    },
                  };
                });

                if (autoTitle) updateTitleRef.current(autoTitle);

                window.dispatchEvent(
                  new CustomEvent("encounter-update", {
                    detail: {
                      id: visitId,
                      status: "to_review",
                      ...(autoTitle ? { title: autoTitle } : {}),
                    },
                  }),
                );
              },
              onError: (error) => {
                throw new Error(error);
              },
            });

            break; // Stream completed successfully
          } catch (err) {
            // Once streaming started, the server IS generating. Don't retry —
            // retrying would start a SECOND generation. Let polling recover instead.
            if (ctx.streamingStarted) break;
            if (isTransientError(err) && attempt < CLIENT_MAX_RETRIES) {
              continue;
            }
            throw err;
          }
        }

        // Persist to database (fire-and-forget, UI already updated)
        if (ctx.completedEvent) {
          const autoTitle = !capturedTitle.trim()
            ? (ctx.completedEvent.suggestedTitle as string)
            : null;
          const patchBody: Record<string, string> = { status: "to_review" };
          if (autoTitle) patchBody.title = autoTitle;

          // Fire-and-forget: don't await, don't block UI
          fetch(`/api/encounters/${visitId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patchBody),
          }).catch(() => {}); // Silent fail - state already updated

          // Email is now sent server-side in /api/generate after saving to DB
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        // Server returned a definitive error — generation won't produce a result
        const isServerError =
          msg === "insufficient_context" || msg === "save_failed";

        if (isServerError) {
          setError(msg);
          setVisit((prev) => (prev ? { ...prev, status: "started" } : prev));
          window.dispatchEvent(
            new CustomEvent("encounter-update", {
              detail: { id: visitId, status: "started" },
            }),
          );
          fetch(`/api/encounters/${visitId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "started" }),
          }).catch(() => {});
        }
        // Connection lost (browser backgrounded, network error) — server is still
        // generating. Keep "processing" so polling recovers when user returns.
      } finally {
        activeGenerations.delete(visitId);

        setIsStreaming(false);
        setIsGenerating(false);

        window.dispatchEvent(
          new CustomEvent("generation-done", { detail: { visitId } }),
        );
      }
    },
    [
      visitId,
      selectedTemplateId,
      doctorNotes,
      audioBlob,
      generationLanguage,
      setVisit,
      setError,
      setCachedTemplate,
    ],
  );

  /* ------------------------------------------------------------------ */
  /*  handleAdjustGenerate — re-generate from review view with new data  */
  /* ------------------------------------------------------------------ */

  const handleAdjustGenerate = useCallback(
    async (opts: {
      adjustRecordingBarRef: React.RefObject<RecordingBarRef | null>;
      additionalNotes?: string;
    }) => {
      if (!visitId || activeGenerations.has(visitId)) return;
      activeGenerations.add(visitId);
      setIsGenerating(true);
      setIsStreaming(false);

      setStreamedSections([]);
      setStreamingSectionIds([]);
      setStreamingSectionLabels({});
      setError(null);

      const capturedTemplateId = selectedTemplateId;

      // Merge additional notes into existing doctor notes
      const mergedNotes = [doctorNotes, opts.additionalNotes]
        .filter(Boolean)
        .join("\n\n");

      // Finalize BEFORE setting processing status — same reason as handleGenerate:
      // status change can unmount the component holding the recording bar ref.
      const finalized = await opts.adjustRecordingBarRef.current?.finalize();
      const blobToProcess = finalized?.blob ?? null;
      const isRestoredSession = finalized?.isRestoredSession ?? false;

      // Now safe to switch to processing UI
      setVisit((prev) => (prev ? { ...prev, status: "processing" } : prev));
      window.dispatchEvent(
        new CustomEvent("encounter-update", {
          detail: { id: visitId, status: "processing" },
        }),
      );

      // Persist generation intent before transcription (same as handleGenerate)
      await fetch(`/api/encounters/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "processing",
          metadata: {
            generation_pending: {
              templateId: capturedTemplateId,
              doctorNotes: mergedNotes || undefined,
            },
          },
        }),
      }).catch(() => {});

      logger.debug(
        `[adjust] Finalized — blob: ${blobToProcess?.size || 0} bytes`,
      );

      // Upload blob to storage for recovery (same as handleGenerate)
      const uploadPromise = blobToProcess
        ? (async () => {
            try {
              const ext = audioMimeToExt(blobToProcess.type);
              const fileName = `recovery${ext}`;
              const { path } = await uploadToStorage(
                new File([blobToProcess], fileName, {
                  type: blobToProcess.type,
                }),
                fileName,
                { encounterId: visitId },
              );
              fetch(`/api/encounters/${visitId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  metadata: {
                    generation_pending: {
                      templateId: capturedTemplateId,
                      doctorNotes: mergedNotes || undefined,
                      audioPath: path,
                    },
                  },
                }),
              }).catch(() => {});
              logger.debug(`[adjust] Recovery blob uploaded: ${path}`);
              return path;
            } catch (err) {
              logger.warn("[adjust] Recovery blob upload failed:", err);
              return null;
            }
          })()
        : Promise.resolve(null);

      // Full-blob transcription for best quality (see handleGenerate comment).
      const finalTranscript = blobToProcess
        ? await transcribeBlob(blobToProcess, generationLanguage, visitId)
        : getTranscript(visit?.metadata as Record<string, unknown>);

      // Wait for recovery upload
      await uploadPromise;

      // Determine audioPath for recovery/concatenation (same logic as handleGenerate)
      const adjustMeta = (visit?.metadata ?? {}) as Record<string, unknown>;
      const adjustPendingMeta = adjustMeta?.generation_pending as
        | { audioPath?: string }
        | undefined;
      const adjustSessionMeta = adjustMeta?.recording_session as
        | { audioPath?: string }
        | undefined;

      let audioRecoveryPath: string | undefined;
      if (!blobToProcess) {
        audioRecoveryPath = adjustPendingMeta?.audioPath || undefined;
      } else if (isRestoredSession && adjustSessionMeta?.audioPath) {
        audioRecoveryPath = adjustSessionMeta.audioPath;
      }

      try {
        // Clear template cache — new context invalidates previous outputs
        clearCache();

        // Re-generate via SSE (same as handleGenerate but no retry logic)
        const ctx = { completedEvent: null as Record<string, unknown> | null };

        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            visitId,
            templateId: capturedTemplateId,
            doctorNotes: mergedNotes || undefined,
            transcriptText: finalTranscript || undefined,
            audioPath: audioRecoveryPath || undefined,
          }),
        });

        if (!res.ok) {
          let message = "generation_failed";
          try {
            const data = await res.json();
            message = data.error || message;
          } catch {
            /* non-JSON response */
          }
          throw new Error(message);
        }

        if (!res.body) throw new Error("generation_failed");

        await parseSSEStream(res.body, {
          onStreamingStart: (e) => {
            setIsStreaming(true);
            setStreamedSections([]);
            setStreamingSectionIds(e.sectionIds);
            setStreamingSectionLabels(e.sectionLabels);
          },
          onSection: (e) => {
            setStreamedSections((prev) => [
              ...prev,
              { id: e.id, title: e.title, content: e.content },
            ]);
          },
          onComplete: (event) => {
            ctx.completedEvent = event;
            setCachedTemplate(capturedTemplateId, {
              generatedNote: event.generatedNote as string,
              letter: (event.letter as string) || "",
            });
            setGeneratedNoteHtml(event.generatedNote as string);

            setVisit((prev) => {
              if (!prev) return prev;
              const existingMeta = (prev.metadata ?? {}) as Record<
                string,
                unknown
              >;
              return {
                ...prev,
                encounter_note: event.generatedNote as string,
                patient_letter: event.letter as string,
                status: "to_review",
                metadata: {
                  ...existingMeta,
                  ...(finalTranscript ? { transcript: finalTranscript } : {}),
                  ...(event.clinicalAnalysis
                    ? { clinical_analysis: event.clinicalAnalysis }
                    : {}),
                },
              };
            });

            window.dispatchEvent(
              new CustomEvent("encounter-update", {
                detail: { id: visitId, status: "to_review" },
              }),
            );
          },
          onError: (error) => {
            throw new Error(error);
          },
        });

        // Persist to database (fire-and-forget, UI already updated)
        if (ctx.completedEvent) {
          fetch(`/api/encounters/${visitId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "to_review" }),
          }).catch(() => {}); // Silent fail - state already updated
        }

        // Update doctor notes to include merged version
        if (mergedNotes) {
          setDoctorNotes(mergedNotes);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        const isServerError =
          msg === "insufficient_context" || msg === "save_failed";
        if (isServerError) {
          setError(msg);
          setVisit((prev) => (prev ? { ...prev, status: "to_review" } : prev));
          window.dispatchEvent(
            new CustomEvent("encounter-update", {
              detail: { id: visitId, status: "to_review" },
            }),
          );
        }
      } finally {
        activeGenerations.delete(visitId);
        setIsStreaming(false);
        setIsGenerating(false);

        window.dispatchEvent(
          new CustomEvent("generation-done", { detail: { visitId } }),
        );
      }
    },
    [
      visitId,
      selectedTemplateId,
      doctorNotes,
      generationLanguage,
      setVisit,
      setError,
      clearCache,
      setCachedTemplate,
    ],
  );

  const handleLanguageChange = useCallback(
    async (lang: SupportedLanguage) => {
      setGenerationLanguage(lang);
      try {
        await fetch(`/api/encounters/${visitId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: lang }),
        });
        setVisit((prev) => (prev ? { ...prev, language: lang } : prev));
      } catch {
        // Silent fail
      }
    },
    [visitId, setVisit],
  );

  // Persist template selection (encounter metadata + localStorage for next time)
  const handleTemplateChange = useCallback(
    (id: string) => {
      setSelectedTemplateId(id);
      setPreferredTemplateId(id);
      if (!visit) return;
      fetch(`/api/encounters/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: { template_id: id } }),
      }).catch(() => {});
    },
    [visit, visitId],
  );

  // Re-generate note with a different template (to_review state) — streaming
  const handleRegenerate = useCallback(
    async (newTemplateId: string) => {
      if (!visitId || newTemplateId === selectedTemplateId || isRegenerating)
        return;

      const previousTemplateId = selectedTemplateId;

      // Cache current template's note before switching
      if (visit?.encounter_note) {
        setCachedTemplate(selectedTemplateId, {
          generatedNote: visit.encounter_note,
          letter: visit.patient_letter || "",
        });
      }

      setSelectedTemplateId(newTemplateId);

      // Instant restore from cache if target template was previously generated
      const cached = getCachedTemplate(newTemplateId);
      if (cached) {
        setGeneratedNoteHtml(cached.generatedNote);
        setVisit((prev) =>
          prev
            ? {
                ...prev,
                encounter_note: cached.generatedNote,
                patient_letter: cached.letter,
              }
            : prev,
        );
        // Persist template switch + restored note to DB
        fetch(`/api/encounters/${visitId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            encounter_note: cached.generatedNote,
            patient_letter: cached.letter,
            metadata: { template_id: newTemplateId },
          }),
        }).catch(() => {});
        return;
      }

      // No cache — proceed with streaming regeneration
      setIsRegenerating(true);
      setStreamedSections([]);
      setError(null);

      // Persist template choice
      if (visit) {
        fetch(`/api/encounters/${visitId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            metadata: { template_id: newTemplateId },
          }),
        }).catch(() => {});
      }

      try {
        for (let attempt = 0; attempt <= CLIENT_MAX_RETRIES; attempt++) {
          if (attempt > 0) {
            logger.warn(
              `[regenerate] Client retry ${attempt}/${CLIENT_MAX_RETRIES}`,
            );
            await new Promise((r) => setTimeout(r, CLIENT_RETRY_DELAY));
            setStreamedSections([]);
          }

          try {
            const res = await fetch("/api/regenerate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                visitId,
                templateId: newTemplateId,
                doctorNotes: doctorNotes || undefined,
              }),
            });

            if (!res.ok) {
              let message = "generation_failed";
              try {
                const data = await res.json();
                message = data.error || message;
              } catch {
                /* non-JSON */
              }
              const err = new Error(message);
              if (
                isTransientError(null, res.status) &&
                attempt < CLIENT_MAX_RETRIES
              )
                continue;
              throw err;
            }

            if (!res.body) throw new Error("generation_failed");

            await parseSSEStream(res.body, {
              onStreamingStart: () => {
                setStreamedSections([]);
              },
              onSection: (e) => {
                setStreamedSections((prev) => [
                  ...prev,
                  { id: e.id, title: e.title, content: e.content },
                ]);
              },
              onComplete: (event) => {
                setCachedTemplate(newTemplateId, {
                  generatedNote: event.generatedNote as string,
                  letter: (event.letter as string) || "",
                });
                setGeneratedNoteHtml(event.generatedNote as string);
                setVisit((prev) =>
                  prev
                    ? {
                        ...prev,
                        encounter_note: event.generatedNote as string,
                        patient_letter: event.letter as string,
                      }
                    : prev,
                );
              },
              onError: (error) => {
                throw new Error(error);
              },
            });

            break; // Success
          } catch (err) {
            if (isTransientError(err) && attempt < CLIENT_MAX_RETRIES) continue;
            throw err;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        const errorKey =
          msg === "save_failed"
            ? msg
            : isTransientError(err)
              ? "network_error"
              : "generation_failed";
        setError(errorKey);

        // Revert template selection so the old note + template stay consistent
        setSelectedTemplateId(previousTemplateId);
        const cachedPrev = getCachedTemplate(previousTemplateId);
        if (cachedPrev) {
          setGeneratedNoteHtml(cachedPrev.generatedNote);
          setVisit((prev) =>
            prev
              ? {
                  ...prev,
                  encounter_note: cachedPrev.generatedNote,
                  patient_letter: cachedPrev.letter,
                }
              : prev,
          );
        }
        // Revert template_id in DB
        if (visit) {
          fetch(`/api/encounters/${visitId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              metadata: { template_id: previousTemplateId },
            }),
          }).catch(() => {});
        }
      } finally {
        setIsRegenerating(false);
      }
    },
    [
      visitId,
      selectedTemplateId,
      isRegenerating,
      visit,
      doctorNotes,
      setVisit,
      setError,
      getCachedTemplate,
      setCachedTemplate,
    ],
  );

  // Polling + generation-done recovery (extracted hook)
  useGenerationPolling({
    visitId,
    visit,
    setVisit,
    isStreaming,
    updateTitleRef,
    setGeneratedNoteHtml,
    setCachedTemplate,
  });

  // Auto-resume: set to true when we detect an interrupted generation on load
  const [pendingResume, setPendingResume] = useState(false);
  const resumeCheckedRef = useRef(false);

  /** Initialize state from fetched visit data */
  const initFromVisit = useCallback(
    (data: Encounter) => {
      setGenerationLanguage((data.language as SupportedLanguage) || "sk");
      const meta = data.metadata as Record<string, unknown>;
      if (meta?.template_id) {
        setSelectedTemplateId(meta.template_id as string);
      }
      if (meta?.doctor_notes) {
        setDoctorNotes(meta.doctor_notes as string);
        initialDoctorNotesRef.current = meta.doctor_notes as string;
      }
      if (data.encounter_note) {
        setGeneratedNoteHtml(data.encounter_note);
        // Seed cache with the initially loaded template's note
        const tid = (meta?.template_id as string) || DEFAULT_TEMPLATE_ID;
        setCachedTemplate(tid, {
          generatedNote: data.encounter_note,
          letter: data.patient_letter || "",
        });
      }

      // Detect interrupted generation — generation_pending exists but no note
      if (meta?.generation_pending && !data.encounter_note) {
        logger.debug(
          "[generate] Detected interrupted generation — will auto-resume",
        );
        setPendingResume(true);
      }
    },
    [setCachedTemplate],
  );

  // Auto-resume interrupted generation. Fires once after initFromVisit
  // detects generation_pending. Uses handleGenerate which will:
  // 1. Prefer stored audio (audioPath) for full-quality server-side transcription
  // 2. Fall back to metadata.transcript if available
  useEffect(() => {
    if (!pendingResume || resumeCheckedRef.current) return;
    if (!visit || isGenerating || isStreaming) return;
    const meta = (visit.metadata ?? {}) as Record<string, unknown>;
    const pending = meta?.generation_pending as
      | { audioPath?: string }
      | undefined;
    const session = meta?.recording_session as
      | { audioPath?: string }
      | undefined;
    // Resume if there's a stored audio blob OR a transcript to work with
    const hasTranscript = !!getTranscript(meta);
    if (!hasTranscript && !pending?.audioPath && !session?.audioPath) {
      // No recovery source — can't resume, reset to draft
      logger.warn(
        "[generate] Auto-resume: no transcript or audio available, resetting",
      );
      resumeCheckedRef.current = true;
      setPendingResume(false);
      setVisit((prev) => (prev ? { ...prev, status: "started" } : prev));
      fetch(`/api/encounters/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "started",
          metadata: { generation_pending: null },
        }),
      }).catch(() => {});
      return;
    }
    resumeCheckedRef.current = true;
    setPendingResume(false);
    logger.debug(
      `[generate] Auto-resuming interrupted generation (audioPath: ${!!pending?.audioPath}, transcript: ${hasTranscript})`,
    );
    handleGenerate();
  }, [
    pendingResume,
    visit,
    isGenerating,
    isStreaming,
    visitId,
    setVisit,
    handleGenerate,
  ]);

  // Calculate content metrics for timer estimation
  // Note: fileCount and imageCount are not available in this hook yet
  // They should be passed from the page component for more accurate estimation
  const visitTranscript = getTranscript(
    visit?.metadata as Record<string, unknown>,
  );
  const contentMetrics = useMemo(
    () => ({
      transcriptLength: visitTranscript?.length || 0,
      doctorNotesLength: doctorNotes.length,
      fileCount: 0, // TODO: Pass files from page component
      imageCount: 0, // TODO: Pass files from page component
    }),
    [visitTranscript, doctorNotes],
  );

  // Generation timer for countdown display — only starts when streaming begins,
  // not during the processing overlay phase (extraction/clinical analysis).
  const timerState = useGenerationTimer({
    isGenerating: isStreaming,
    totalSections: streamingSectionIds.length || 8,
    completedSections: streamedSections.length,
    contentMetrics,
  });

  return {
    generationLanguage,
    selectedTemplateId,
    doctorNotes,
    setDoctorNotes,
    generatedNoteHtml,
    setGeneratedNoteHtml,
    isStreaming,
    isGenerating,
    isRegenerating,
    streamedSections,
    streamingSectionIds,
    streamingSectionLabels,
    audioBlob,
    hasActiveRecording,
    recordingBarRef,
    syncTitle,
    initFromVisit,
    handleRecordingStateChange,
    handleGenerate,
    handleLanguageChange,
    handleTemplateChange,
    handleRegenerate,
    handleAdjustGenerate,
    timerState,
    saveStatus: saveStatus.status,
  };
}
