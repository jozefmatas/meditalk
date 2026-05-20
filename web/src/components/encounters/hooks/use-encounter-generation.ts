"use client";

import {
  useState,
  useReducer,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import type { Encounter, SupportedLanguage } from "@/lib/types";
import {
  type EncounterFile,
  awaitPendingContextSave,
  awaitPendingExtractions,
} from "@/lib/encounters/file-state";
import { decideResumeAction } from "./auto-resume";
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
  useEffect(() => {
    updateTitleRef.current = updateTitle;
  });
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

  // ── Shared stream-execute → completion → error-recovery ────────

  /**
   * Shared flow for handleGenerate and handleAdjustGenerate:
   * pre-stream work → stream.executeStream → onComplete → error recovery.
   *
   * Callers do their own recording-finalize / processing-switch / prepareSource
   * before handing off to this helper.
   */
  async function executeGenerationFlow(params: {
    url: string;
    body: Record<string, unknown>;
    retry: boolean;
    templateId: string;
    transcriptText?: string;
    /** Status to revert to on error ("started" for generate, "to_review" for adjust). */
    errorRecoveryStatus: "started" | "to_review";
    /** If true, clears generation_pending metadata on error (generate only). */
    clearGenerationPending?: boolean;
    /** Captured title at call time. If provided AND empty, enables auto-title. */
    autoTitleCapture?: string;
    /** Runs inside the try block before the stream starts (e.g. await saves). */
    preStream?: () => Promise<void>;
    /** Runs after a successful stream (e.g. merge doctor notes). */
    postSuccess?: () => void;
  }) {
    try {
      await params.preStream?.();

      const completedEvent = await stream.executeStream({
        url: params.url,
        body: params.body,
        retry: params.retry,
        onComplete: (event) => {
          setCachedTemplate(params.templateId, {
            generatedNote: event.generatedNote as string,
          });
          setGeneratedNoteHtml(event.generatedNote as string);

          const autoTitle =
            params.autoTitleCapture !== undefined &&
            !params.autoTitleCapture.trim()
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
                ...(params.transcriptText
                  ? { transcript: params.transcriptText }
                  : {}),
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
        const autoTitle =
          params.autoTitleCapture !== undefined &&
          !params.autoTitleCapture.trim()
            ? (completedEvent.suggestedTitle as string)
            : null;
        patchEncounter(visitId, {
          status: "to_review",
          ...(autoTitle ? { title: autoTitle } : {}),
        });
      }

      params.postSuccess?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      const isKnownError =
        msg === "insufficient_context" || msg === "save_failed";
      if (isKnownError) setError(msg);

      // Always reset status so the encounter never stays stuck on "processing".
      // patchEncounterStatus emits "encounter-update" internally, so no manual emit needed.
      setVisit((prev) =>
        prev ? { ...prev, status: params.errorRecoveryStatus } : prev,
      );

      patchEncounterStatus(
        visitId,
        params.errorRecoveryStatus,
        params.clearGenerationPending
          ? { metadata: { generation_pending: null } }
          : undefined,
      );
    }
  }

  // ── handleGenerate ──────────────────────────────────────────────

  const handleGenerate = useCallback(
    async (options?: { sendAsEmail?: boolean }) => {
      const capturedTemplateId = selectedTemplateId;
      const capturedDoctorNotes = doctorNotes;
      const capturedTitle = titleRef.current;

      // 1. Finalize recording (fast, local-only — must happen before UI switch)
      const bar = recordingBarRef.current;
      const finalized = bar
        ? {
            ...(await bar.finalize()),
            releaseGuards: bar.releaseGuards,
          }
        : null;

      // 2. Switch to processing UI immediately
      setVisit((prev) => (prev ? { ...prev, status: "processing" } : prev));
      emit("encounter-update", { id: visitId, status: "processing" });

      // 3. Upload blob + resolve audio recovery path
      // (server-side waitForTranscript handles transcript reuse)
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

      releaseGuards?.();

      await executeGenerationFlow({
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
        templateId: capturedTemplateId,
        transcriptText: transcriptText ?? undefined,
        errorRecoveryStatus: "started",
        clearGenerationPending: true,
        autoTitleCapture: capturedTitle,
        preStream: async () => {
          setAudioBlob(null);
          await awaitPendingContextSave(visitId);
          await awaitPendingExtractions(visitId);
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- executeGenerationFlow captures the same deps listed here
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

      await executeGenerationFlow({
        url: "/api/adjust",
        body: {
          visitId,
          templateId: capturedTemplateId,
          adjustmentTranscript: transcriptText || undefined,
        },
        retry: false,
        templateId: capturedTemplateId,
        transcriptText: transcriptText ?? undefined,
        errorRecoveryStatus: "to_review",
        preStream: async () => {
          clearCache();
          await awaitPendingContextSave(visitId);
        },
        postSuccess: () => {
          if (mergedNotes) setDoctorNotes(mergedNotes);
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- executeGenerationFlow captures the same deps listed here
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
  const handleGenerateRef = useRef(handleGenerate);
  useEffect(() => {
    visitRef.current = visit;
    handleGenerateRef.current = handleGenerate;
  });

  const handlePollTimeout = useCallback(() => {
    if (pollTimeoutResumedRef.current) return;
    const v = visitRef.current;
    if (v?.metadata?.generation_pending && !v?.encounter_note) {
      pollTimeoutResumedRef.current = true;
      logger.debug("[generate] Poll timeout — auto-resuming lost generation");
      handleGenerateRef.current();
    }
  }, []);

  useGenerationPolling({
    visitId,
    visit,
    setVisit,
    isStreaming: stream.isStreaming || stream.isGenerating,
    updateTitleRef,
    setGeneratedNoteHtml,
    setCachedTemplate,
    onPollTimeout: handlePollTimeout,
  });

  // ── Auto-resume ─────────────────────────────────────────────────

  // 3-phase state machine for resuming an interrupted generation:
  //   idle    → no resume scheduled
  //   pending → initFromVisit detected an interrupted generation; the
  //             effect below will fire once streaming state is stable
  //             and run the decision via `decideResumeAction`
  //   done    → terminal; effect never reruns the decision in this
  //             component instance
  const [autoResumePhase, dispatchAutoResume] = useReducer(
    (phase: "idle" | "pending" | "done", action: "request" | "complete") => {
      if (phase === "done") return phase;
      return action === "request" ? "pending" : "done";
    },
    "idle",
  );

  const initFromVisit = useCallback(
    (data: Encounter) => {
      setGenerationLanguage((data.language as SupportedLanguage) || "sk");
      if (data.metadata?.template_id) {
        setSelectedTemplateId(data.metadata.template_id);
      }
      if (data.metadata?.doctor_notes) {
        initDoctorNotes(data.metadata.doctor_notes);
      }
      if (data.encounter_note) {
        setGeneratedNoteHtml(data.encounter_note);
        const tid = data.metadata?.template_id || DEFAULT_TEMPLATE_ID;
        setCachedTemplate(tid, {
          generatedNote: data.encounter_note,
        });
      }

      if (data.status === "processing" || isGenerationActive(visitId)) {
        stream.restoreFromCache();
      }

      if (
        data.metadata?.generation_pending &&
        !data.encounter_note &&
        data.status !== "processing"
      ) {
        logger.debug(
          "[generate] Detected interrupted generation — will auto-resume",
        );
        dispatchAutoResume("request");
      }
    },
    [setCachedTemplate, visitId, initDoctorNotes, stream],
  );

  // Auto-resume interrupted generation. Decision logic lives in
  // `decideResumeAction` (pure, unit-tested in auto-resume.test.ts);
  // this effect only sequences the dispatch + side effects once
  // streaming state has settled.
  useEffect(() => {
    if (autoResumePhase !== "pending") return;
    if (!visit || stream.isGenerating || stream.isStreaming) return;

    const action = decideResumeAction(visit);
    dispatchAutoResume("complete");

    if (action === "no-op") return;

    if (action === "reset") {
      logger.warn(
        "[generate] Auto-resume: no transcript or audio available, resetting",
      );
      setVisit((prev) => (prev ? { ...prev, status: "started" } : prev));
      patchEncounter(visitId, {
        status: "started",
        metadata: { generation_pending: null },
      });
      return;
    }

    // action === "generate"
    const meta = visit.metadata;
    logger.debug(
      `[generate] Auto-resuming interrupted generation (audioPath: ${!!meta?.generation_pending?.audioPath}, transcript: ${!!getTranscript(meta ?? null)})`,
    );
    handleGenerate();
  }, [
    autoResumePhase,
    visit,
    stream.isGenerating,
    stream.isStreaming,
    visitId,
    setVisit,
    handleGenerate,
  ]);

  // ── Timer ───────────────────────────────────────────────────────

  const visitTranscript = getTranscript(visit?.metadata ?? null);
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
    progressStage: stream.progressStage,
    timerState,
    saveStatus,
  };
}
