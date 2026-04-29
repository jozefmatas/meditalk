"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { Encounter, SupportedLanguage } from "@/lib/types";
import {
  type EncounterFile,
  awaitPendingContextSave,
  awaitPendingExtractions,
} from "@/lib/encounters/file-state";
import { type RecordingBarRef } from "@/components/encounters/recording-bar";
import {
  DEFAULT_TEMPLATE_ID,
  getPreferredTemplateId,
  setPreferredTemplateId,
} from "@/lib/templates";
import { useGenerationTimer } from "@/hooks/use-generation-timer";
import { useTemplateCache } from "./use-template-cache";
import { useGenerationPolling } from "./use-generation-polling";
import { useDoctorNotes } from "./use-doctor-notes";
import {
  useGenerationStream,
  isGenerationActive,
} from "./use-generation-stream";
import { usePreGeneration } from "./use-pre-generation";
import { getTranscript } from "@/lib/encounters/sources";
import { emit } from "@/lib/events";
import { patchEncounter, patchEncounterStatus } from "@/lib/encounters/api";
import { logger } from "@/lib/logger";

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
  // ── Composed hooks ──────────────────────────────────────────────

  const {
    doctorNotes,
    setDoctorNotes,
    saveStatus,
    initFromVisit: initDoctorNotes,
  } = useDoctorNotes(visitId);

  const stream = useGenerationStream(visitId);
  const { prepareSource } = usePreGeneration(visitId);

  // ── Local state ─────────────────────────────────────────────────

  const [generationLanguage, setGenerationLanguage] =
    useState<SupportedLanguage>("sk");
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    getPreferredTemplateId,
  );
  const [generatedNoteHtml, setGeneratedNoteHtml] = useState("");
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [hasActiveRecording, setHasActiveRecording] = useState(false);
  const recordingBarRef = useRef<RecordingBarRef>(null);

  const { getCachedTemplate, setCachedTemplate, clearCache } =
    useTemplateCache();

  // Stable refs for callbacks
  const updateTitleRef = useRef(updateTitle);
  updateTitleRef.current = updateTitle;
  const titleRef = useRef("");
  const syncTitle = useCallback((t: string) => {
    titleRef.current = t;
  }, []);

  // ── Recording state change ──────────────────────────────────────

  const handleRecordingStateChange = useCallback(
    (recordingState: "idle" | "recording" | "paused") => {
      setHasActiveRecording(recordingState !== "idle");

      setFiles((prev: EncounterFile[]) =>
        prev.map((f) =>
          f.source === "recording" && f.pending
            ? { ...f, isRecording: recordingState === "recording" }
            : f,
        ),
      );

      if (isGenerationActive(visitId)) return;
      const status = recordingState === "recording" ? "recording" : "started";
      setVisit((prev) => (prev ? { ...prev, status } : prev));
      patchEncounterStatus(visitId, status);
    },
    [visitId, setVisit, setFiles],
  );

  // ── handleGenerate ──────────────────────────────────────────────

  const handleGenerate = useCallback(
    async (options?: { sendAsEmail?: boolean }) => {
      const capturedTemplateId = selectedTemplateId;
      const capturedDoctorNotes = doctorNotes;
      const capturedTitle = titleRef.current;

      // 1. Finalize recording synchronously (fast, local-only)
      //    Must happen BEFORE the UI switch — the recording bar unmounts
      //    when status changes to "processing".
      const bar = recordingBarRef.current;
      const finalized = bar
        ? {
            ...(await bar.finalize()),
            releaseGuards: bar.releaseGuards,
          }
        : null;

      // 2. Switch to processing UI immediately (user sees overlay now)
      setVisit((prev) => (prev ? { ...prev, status: "processing" } : prev));
      emit("encounter-update", { id: visitId, status: "processing" });

      // 3. Upload blob + transcribe (slow, network) with pre-finalized blob
      const { transcriptText, audioRecoveryPath, releaseGuards } =
        await prepareSource({
          recordingBarRef,
          language: generationLanguage,
          visit,
          finalized,
        });

      // Persist generation intent after we know the audio path
      await patchEncounter(visitId, {
        status: "processing",
        metadata: {
          generation_pending: {
            templateId: capturedTemplateId,
            doctorNotes: capturedDoctorNotes || undefined,
            ...(audioRecoveryPath ? { audioPath: audioRecoveryPath } : {}),
            startedAt: new Date().toISOString(),
          },
        },
      });

      // Tear down foreground service after transcription
      releaseGuards?.();

      try {
        setAudioBlob(null);
        await awaitPendingContextSave(visitId);
        await awaitPendingExtractions(visitId);

        const completedEvent = await stream.executeStream({
          url: "/api/generate",
          body: {
            visitId,
            templateId: capturedTemplateId,
            doctorNotes: capturedDoctorNotes || undefined,
            transcriptText: transcriptText || undefined,
            audioPath: audioRecoveryPath || undefined,
            sendAsEmail: options?.sendAsEmail || false,
          },
          retry: true,
          onComplete: (event) => {
            setCachedTemplate(capturedTemplateId, {
              generatedNote: event.generatedNote as string,
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
                status: "to_review",
                ...(autoTitle ? { title: autoTitle } : {}),
                metadata: {
                  ...existingMeta,
                  ...(transcriptText ? { transcript: transcriptText } : {}),
                  ...(event.clinicalAnalysis
                    ? { clinical_analysis: event.clinicalAnalysis }
                    : {}),
                },
              };
            });

            if (autoTitle) updateTitleRef.current(autoTitle);

            emit("encounter-update", {
              id: visitId,
              status: "to_review",
              ...(autoTitle ? { title: autoTitle } : {}),
            });
          },
        });

        // Persist to database (fire-and-forget)
        if (completedEvent) {
          const autoTitle = !capturedTitle.trim()
            ? (completedEvent.suggestedTitle as string)
            : null;
          patchEncounter(visitId, {
            status: "to_review",
            ...(autoTitle ? { title: autoTitle } : {}),
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        const isServerError =
          msg === "insufficient_context" || msg === "save_failed";

        if (isServerError) {
          setError(msg);
          setVisit((prev) => (prev ? { ...prev, status: "started" } : prev));
          patchEncounterStatus(visitId, "started", {
            metadata: { generation_pending: null },
          });
        }
      }
    },
    [
      visitId,
      selectedTemplateId,
      doctorNotes,
      generationLanguage,
      visit,
      prepareSource,
      stream,
      setVisit,
      setError,
      setCachedTemplate,
    ],
  );

  // ── handleAdjustGenerate ────────────────────────────────────────

  const handleAdjustGenerate = useCallback(
    async (opts: {
      adjustRecordingBarRef: React.RefObject<RecordingBarRef | null>;
      additionalNotes?: string;
    }) => {
      const capturedTemplateId = selectedTemplateId;
      const mergedNotes = [doctorNotes, opts.additionalNotes]
        .filter(Boolean)
        .join("\n\n");

      // 1. Finalize recording (fast, local-only)
      const bar = opts.adjustRecordingBarRef.current;
      const finalized = bar
        ? {
            ...(await bar.finalize()),
            releaseGuards: bar.releaseGuards,
          }
        : null;

      // 2. Switch to processing UI immediately
      setVisit((prev) => (prev ? { ...prev, status: "processing" } : prev));

      // 3. Upload blob + transcribe (slow, network)
      const { transcriptText, releaseGuards } = await prepareSource({
        recordingBarRef: opts.adjustRecordingBarRef,
        language: generationLanguage,
        visit,
        finalized,
      });

      await patchEncounterStatus(visitId, "processing", {
        metadata: {
          generation_pending: {
            templateId: capturedTemplateId,
            doctorNotes: mergedNotes || undefined,
            startedAt: new Date().toISOString(),
          },
        },
      });

      releaseGuards?.();

      try {
        clearCache();
        await awaitPendingContextSave(visitId);

        const completedEvent = await stream.executeStream({
          url: "/api/adjust",
          body: {
            visitId,
            templateId: capturedTemplateId,
            adjustmentTranscript: transcriptText || undefined,
          },
          retry: false,
          onComplete: (event) => {
            setCachedTemplate(capturedTemplateId, {
              generatedNote: event.generatedNote as string,
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
                status: "to_review",
                metadata: {
                  ...existingMeta,
                  ...(transcriptText ? { transcript: transcriptText } : {}),
                  ...(event.clinicalAnalysis
                    ? { clinical_analysis: event.clinicalAnalysis }
                    : {}),
                },
              };
            });

            emit("encounter-update", { id: visitId, status: "to_review" });
          },
        });

        if (completedEvent) {
          patchEncounter(visitId, { status: "to_review" });
        }

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
          emit("encounter-update", { id: visitId, status: "to_review" });
        }
      }
    },
    [
      visitId,
      selectedTemplateId,
      doctorNotes,
      generationLanguage,
      visit,
      prepareSource,
      stream,
      setVisit,
      setError,
      clearCache,
      setCachedTemplate,
      setDoctorNotes,
    ],
  );

  // ── handleRegenerate (template swap → /api/generate cached mode) ─

  const handleRegenerate = useCallback(
    async (newTemplateId: string) => {
      if (!visitId || newTemplateId === selectedTemplateId || isRegenerating)
        return;

      const previousTemplateId = selectedTemplateId;

      // Cache current template's note before switching
      if (visit?.encounter_note) {
        setCachedTemplate(selectedTemplateId, {
          generatedNote: visit.encounter_note,
        });
      }

      setSelectedTemplateId(newTemplateId);

      // Instant restore from cache if target template was previously generated
      const cached = getCachedTemplate(newTemplateId);
      if (cached) {
        setGeneratedNoteHtml(cached.generatedNote);
        setVisit((prev) =>
          prev ? { ...prev, encounter_note: cached.generatedNote } : prev,
        );
        patchEncounter(visitId, {
          encounter_note: cached.generatedNote,
          metadata: { template_id: newTemplateId },
        });
        return;
      }

      // No cache — stream via /api/generate (cached mode: no transcriptText/audioPath)
      setIsRegenerating(true);
      setError(null);

      if (visit) {
        patchEncounter(visitId, {
          metadata: { template_id: newTemplateId },
        });
      }

      try {
        await stream.executeStream({
          url: "/api/generate",
          body: {
            visitId,
            templateId: newTemplateId,
            doctorNotes: doctorNotes || undefined,
          },
          retry: true,
          onComplete: (event) => {
            setCachedTemplate(newTemplateId, {
              generatedNote: event.generatedNote as string,
            });
            setGeneratedNoteHtml(event.generatedNote as string);
            setVisit((prev) =>
              prev
                ? {
                    ...prev,
                    encounter_note: event.generatedNote as string,
                  }
                : prev,
            );
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        const errorKey = msg === "save_failed" ? msg : "generation_failed";
        setError(errorKey);

        // Revert template selection
        setSelectedTemplateId(previousTemplateId);
        const cachedPrev = getCachedTemplate(previousTemplateId);
        if (cachedPrev) {
          setGeneratedNoteHtml(cachedPrev.generatedNote);
          setVisit((prev) =>
            prev ? { ...prev, encounter_note: cachedPrev.generatedNote } : prev,
          );
        }
        if (visit) {
          patchEncounter(visitId, {
            metadata: { template_id: previousTemplateId },
          });
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
      stream,
      setVisit,
      setError,
      getCachedTemplate,
      setCachedTemplate,
    ],
  );

  // ── Language change ─────────────────────────────────────────────

  const handleLanguageChange = useCallback(
    async (lang: SupportedLanguage) => {
      setGenerationLanguage(lang);
      const res = await patchEncounter(visitId, { language: lang });
      if (res?.ok) {
        setVisit((prev) => (prev ? { ...prev, language: lang } : prev));
      }
    },
    [visitId, setVisit],
  );

  // ── Template change ─────────────────────────────────────────────

  const handleTemplateChange = useCallback(
    (id: string) => {
      setSelectedTemplateId(id);
      setPreferredTemplateId(id);
      if (!visit) return;
      patchEncounter(visitId, { metadata: { template_id: id } });
    },
    [visit, visitId],
  );

  // ── Poll timeout recovery ──────────────────────────────────────

  const pollTimeoutResumedRef = useRef(false);
  const visitRef = useRef(visit);
  visitRef.current = visit;
  const handleGenerateRef = useRef(handleGenerate);
  handleGenerateRef.current = handleGenerate;

  const handlePollTimeout = useCallback(() => {
    if (pollTimeoutResumedRef.current) return;
    const v = visitRef.current;
    const meta = (v?.metadata ?? {}) as Record<string, unknown>;
    if (meta?.generation_pending && !v?.encounter_note) {
      pollTimeoutResumedRef.current = true;
      logger.debug("[generate] Poll timeout — auto-resuming lost generation");
      handleGenerateRef.current();
    }
  }, []);

  useGenerationPolling({
    visitId,
    visit,
    setVisit,
    isStreaming: stream.isStreaming,
    setIsGenerating: () => {}, // managed by stream hook
    setIsStreaming: () => {}, // managed by stream hook
    updateTitleRef,
    setGeneratedNoteHtml,
    setCachedTemplate,
    onPollTimeout: handlePollTimeout,
  });

  // ── Auto-resume ─────────────────────────────────────────────────

  const [pendingResume, setPendingResume] = useState(false);
  const resumeCheckedRef = useRef(false);

  const initFromVisit = useCallback(
    (data: Encounter) => {
      setGenerationLanguage((data.language as SupportedLanguage) || "sk");
      const meta = data.metadata as Record<string, unknown>;
      if (meta?.template_id) {
        setSelectedTemplateId(meta.template_id as string);
      }
      if (meta?.doctor_notes) {
        initDoctorNotes(meta.doctor_notes as string);
      }
      if (data.encounter_note) {
        setGeneratedNoteHtml(data.encounter_note);
        const tid = (meta?.template_id as string) || DEFAULT_TEMPLATE_ID;
        setCachedTemplate(tid, {
          generatedNote: data.encounter_note,
        });
      }

      if (data.status === "processing" || isGenerationActive(visitId)) {
        stream.restoreFromCache();
      }

      if (
        meta?.generation_pending &&
        !data.encounter_note &&
        data.status !== "processing"
      ) {
        logger.debug(
          "[generate] Detected interrupted generation — will auto-resume",
        );
        setPendingResume(true);
      }
    },
    [setCachedTemplate, visitId, initDoctorNotes, stream],
  );

  // Auto-resume interrupted generation
  useEffect(() => {
    if (!pendingResume || resumeCheckedRef.current) return;
    if (!visit || stream.isGenerating || stream.isStreaming) return;

    if (visit.status === "processing") {
      resumeCheckedRef.current = true;
      setPendingResume(false);
      return;
    }

    const meta = (visit.metadata ?? {}) as Record<string, unknown>;
    const pending = meta?.generation_pending as
      | { audioPath?: string }
      | undefined;
    const session = meta?.recording_session as
      | { audioPath?: string }
      | undefined;
    const hasTranscript = !!getTranscript(meta);
    const metaFiles = (meta?.files ?? []) as {
      extracted_text?: string | null;
      source?: string;
    }[];
    const hasExtractedFiles = metaFiles.some(
      (f) => f.extracted_text && f.source !== "recording",
    );
    if (
      !hasTranscript &&
      !hasExtractedFiles &&
      !pending?.audioPath &&
      !session?.audioPath
    ) {
      logger.warn(
        "[generate] Auto-resume: no transcript or audio available, resetting",
      );
      resumeCheckedRef.current = true;
      setPendingResume(false);
      setVisit((prev) => (prev ? { ...prev, status: "started" } : prev));
      patchEncounter(visitId, {
        status: "started",
        metadata: { generation_pending: null },
      });
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
    stream.isGenerating,
    stream.isStreaming,
    visitId,
    setVisit,
    handleGenerate,
  ]);

  // ── Timer ───────────────────────────────────────────────────────

  const visitTranscript = getTranscript(
    visit?.metadata as Record<string, unknown>,
  );
  const contentMetrics = useMemo(
    () => ({
      transcriptLength: visitTranscript?.length || 0,
      doctorNotesLength: doctorNotes.length,
      fileCount: 0,
      imageCount: 0,
    }),
    [visitTranscript, doctorNotes],
  );

  const timerState = useGenerationTimer({
    isGenerating: stream.isStreaming,
    totalSections: stream.streamingSectionIds.length || 8,
    completedSections: stream.streamedSections.length,
    contentMetrics,
  });

  // ── Return (same shape as before) ──────────────────────────────

  return {
    generationLanguage,
    selectedTemplateId,
    doctorNotes,
    setDoctorNotes,
    generatedNoteHtml,
    setGeneratedNoteHtml,
    isStreaming: stream.isStreaming,
    isGenerating: stream.isGenerating,
    isRegenerating,
    streamedSections: stream.streamedSections,
    streamingSectionIds: stream.streamingSectionIds,
    streamingSectionLabels: stream.streamingSectionLabels,
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
    saveStatus,
  };
}
