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

  // Client-side cache: templateId → { generatedNote, letter }
  // Enables instant switching between previously generated templates
  const templateCacheRef = useRef<
    Map<string, { generatedNote: string; letter: string }>
  >(new Map());

  // Stable refs for callbacks
  const updateTitleRef = useRef(updateTitle);
  updateTitleRef.current = updateTitle;

  // We need access to current title for handleGenerate without adding it as dependency
  const titleRef = useRef("");
  /** Keep titleRef in sync — call this from page when title changes */
  const syncTitle = useCallback((t: string) => {
    titleRef.current = t;
  }, []);

  // Re-fetch encounter when a background generation completes
  useEffect(() => {
    const handler = (e: Event) => {
      const { visitId: doneId } = (e as CustomEvent).detail;
      if (doneId !== visitId) return;

      // Re-fetch encounter to pick up generated note + updated status
      (async () => {
        try {
          const res = await fetch(`/api/encounters/${visitId}`);
          if (!res.ok) return;
          const data: Encounter = await res.json();
          setVisit(data);
          if (data.title) updateTitleRef.current(data.title);
          if (data.encounter_note) setGeneratedNoteHtml(data.encounter_note);
        } catch {
          /* silent */
        }
      })();
    };
    window.addEventListener("generation-done", handler);
    return () => window.removeEventListener("generation-done", handler);
  }, [visitId, setVisit]);

  // Auto-save doctor notes (2s debounce)
  useEffect(() => {
    if (!visit || doctorNotes === initialDoctorNotesRef.current) return;

    const timeout = setTimeout(async () => {
      try {
        await fetch(`/api/encounters/${visitId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            metadata: { ...visit.metadata, doctor_notes: doctorNotes },
          }),
        });
        initialDoctorNotesRef.current = doctorNotes;
      } catch {
        // Silent fail
      }
    }, 2000);

    return () => clearTimeout(timeout);
  }, [doctorNotes, visit, visitId]);

  const handleRecordingComplete = useCallback((blob: Blob | null) => {
    console.log(
      `[recording] handleRecordingComplete — blob size: ${blob?.size || 0}`,
    );
    // Keep blob in memory for canGenerate check.
    // Transcript comes from finalize() and is passed directly to /api/generate.
    if (blob) {
      setAudioBlob(blob);
    }
  }, []);

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
      setIsStreaming(false);

      setStreamedSections([]);
      setStreamingSectionIds([]);
      setStreamingSectionLabels({});
      setError(null);

      // Capture values at call time so the chain works even after unmount
      const capturedTemplateId = selectedTemplateId;
      const capturedDoctorNotes = doctorNotes;
      const capturedTitle = titleRef.current;

      // Set processing state immediately — the activeGenerations guard in
      // handleRecordingStateChange prevents finalize()'s "idle" from overriding this.
      setVisit((prev) => (prev ? { ...prev, status: "processing" } : prev));
      window.dispatchEvent(
        new CustomEvent("encounter-update", {
          detail: { id: visitId, status: "processing" },
        }),
      );
      fetch(`/api/encounters/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "processing" }),
      }).catch(() => {});

      const finalized = await recordingBarRef.current?.finalize();
      const blobToProcess = finalized?.blob ?? audioBlob;
      const streamingTranscript = finalized?.transcript ?? null;

      console.log(
        `[generate] Finalized — transcript: ${streamingTranscript ? `${streamingTranscript.length} chars` : "NONE"}, blob: ${blobToProcess?.size || 0} bytes`,
      );

      try {
        // Recording is now handled via real-time transcript - no upload needed
        setAudioBlob(null);

        // Generate note via SSE streaming (with client-side retry for transient errors)
        let completedEvent: Record<string, unknown> | null = null;
        let streamingStarted = false;

        for (let attempt = 0; attempt <= CLIENT_MAX_RETRIES; attempt++) {
          if (attempt > 0) {
            console.warn(
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
                transcriptText: streamingTranscript || undefined,
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
            const reader = res.body?.getReader();
            if (!reader) throw new Error("generation_failed");

            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });

              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";

              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const jsonStr = line.slice(6);
                if (!jsonStr) continue;

                try {
                  const event = JSON.parse(jsonStr);

                  if (event.type === "streaming_start") {
                    streamingStarted = true;
                    setIsStreaming(true);
                    setStreamedSections([]);
                    setStreamingSectionIds(event.sectionIds);
                    setStreamingSectionLabels(event.sectionLabels);
                  } else if (event.type === "section") {
                    setStreamedSections((prev) => [
                      ...prev,
                      {
                        id: event.id,
                        title: event.title,
                        content: event.content,
                      },
                    ]);
                  } else if (event.type === "complete") {
                    completedEvent = event;
                    templateCacheRef.current.set(capturedTemplateId, {
                      generatedNote: event.generatedNote,
                      letter: event.letter || "",
                    });
                    setGeneratedNoteHtml(event.generatedNote);

                    // Calculate auto-title immediately (needs capturedTitle from closure)
                    const autoTitle = !capturedTitle.trim()
                      ? (event.suggestedTitle as string)
                      : null;

                    // ATOMIC UPDATE: Set note content + status + title together
                    setVisit((prev) => {
                      if (!prev) return prev;
                      const existingMeta = (prev.metadata ?? {}) as Record<
                        string,
                        unknown
                      >;
                      return {
                        ...prev,
                        encounter_note: event.generatedNote,
                        patient_letter: event.letter,
                        status: "to_review", // Set status atomically
                        ...(streamingTranscript
                          ? { raw_text: streamingTranscript }
                          : {}),
                        ...(autoTitle ? { title: autoTitle } : {}), // Set title atomically
                        metadata: {
                          ...existingMeta,
                          ...(event.clinicalAnalysis
                            ? { clinical_analysis: event.clinicalAnalysis }
                            : {}),
                        },
                      };
                    });

                    // Update title callback if auto-title was generated
                    if (autoTitle) updateTitleRef.current(autoTitle);

                    // Dispatch event immediately for sidebar sync
                    window.dispatchEvent(
                      new CustomEvent("encounter-update", {
                        detail: {
                          id: visitId,
                          status: "to_review",
                          ...(autoTitle ? { title: autoTitle } : {}),
                        },
                      }),
                    );
                  } else if (event.type === "error") {
                    throw new Error(event.error);
                  }
                } catch (parseErr) {
                  if (
                    parseErr instanceof Error &&
                    parseErr.message !== "Unexpected end of JSON input"
                  ) {
                    throw parseErr;
                  }
                }
              }
            }

            break; // Stream completed successfully
          } catch (err) {
            // Once streaming started, the server IS generating. Don't retry —
            // retrying would start a SECOND generation. Let polling recover instead.
            if (streamingStarted) break;
            if (isTransientError(err) && attempt < CLIENT_MAX_RETRIES) {
              continue;
            }
            throw err;
          }
        }

        // Persist to database (fire-and-forget, UI already updated)
        if (completedEvent) {
          const autoTitle = !capturedTitle.trim()
            ? (completedEvent.suggestedTitle as string)
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

        window.dispatchEvent(
          new CustomEvent("generation-done", { detail: { visitId } }),
        );
      }
    },
    [visitId, selectedTemplateId, doctorNotes, audioBlob, setVisit, setError],
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

      // Set processing state
      setVisit((prev) => (prev ? { ...prev, status: "processing" } : prev));
      window.dispatchEvent(
        new CustomEvent("encounter-update", {
          detail: { id: visitId, status: "processing" },
        }),
      );
      fetch(`/api/encounters/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "processing" }),
      }).catch(() => {});

      // Finalize any recording in the adjust drawer
      const finalized = await opts.adjustRecordingBarRef.current?.finalize();
      const streamingTranscript = finalized?.transcript ?? null;

      try {
        // Recording is now handled via real-time transcript - no upload needed
        // Clear template cache — new context invalidates previous outputs
        templateCacheRef.current.clear();

        // Re-generate via SSE (same as handleGenerate but no retry logic)
        let completedEvent: Record<string, unknown> | null = null;

        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            visitId,
            templateId: capturedTemplateId,
            doctorNotes: mergedNotes || undefined,
            transcriptText: streamingTranscript || undefined,
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

        const reader = res.body?.getReader();
        if (!reader) throw new Error("generation_failed");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6);
            if (!jsonStr) continue;

            try {
              const event = JSON.parse(jsonStr);

              if (event.type === "streaming_start") {
                setIsStreaming(true);
                setStreamedSections([]);
                setStreamingSectionIds(event.sectionIds);
                setStreamingSectionLabels(event.sectionLabels);
              } else if (event.type === "section") {
                setStreamedSections((prev) => [
                  ...prev,
                  {
                    id: event.id,
                    title: event.title,
                    content: event.content,
                  },
                ]);
              } else if (event.type === "complete") {
                completedEvent = event;
                templateCacheRef.current.set(capturedTemplateId, {
                  generatedNote: event.generatedNote,
                  letter: event.letter || "",
                });
                setGeneratedNoteHtml(event.generatedNote);

                // ATOMIC UPDATE: Set note content + status together
                setVisit((prev) => {
                  if (!prev) return prev;
                  const existingMeta = (prev.metadata ?? {}) as Record<
                    string,
                    unknown
                  >;
                  return {
                    ...prev,
                    encounter_note: event.generatedNote,
                    patient_letter: event.letter,
                    status: "to_review", // Set status atomically
                    ...(streamingTranscript
                      ? { raw_text: streamingTranscript }
                      : {}),
                    metadata: {
                      ...existingMeta,
                      ...(event.clinicalAnalysis
                        ? { clinical_analysis: event.clinicalAnalysis }
                        : {}),
                    },
                  };
                });

                // Dispatch event immediately for sidebar sync
                window.dispatchEvent(
                  new CustomEvent("encounter-update", {
                    detail: { id: visitId, status: "to_review" },
                  }),
                );
              } else if (event.type === "error") {
                throw new Error(event.error);
              }
            } catch (parseErr) {
              if (
                parseErr instanceof Error &&
                parseErr.message !== "Unexpected end of JSON input"
              ) {
                throw parseErr;
              }
            }
          }
        }

        // Persist to database (fire-and-forget, UI already updated)
        if (completedEvent) {
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

        window.dispatchEvent(
          new CustomEvent("generation-done", { detail: { visitId } }),
        );
      }
    },
    [visitId, selectedTemplateId, doctorNotes, setVisit, setError],
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
      const meta = (visit.metadata || {}) as Record<string, unknown>;
      fetch(`/api/encounters/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: { ...meta, template_id: id } }),
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
        templateCacheRef.current.set(selectedTemplateId, {
          generatedNote: visit.encounter_note,
          letter: visit.patient_letter || "",
        });
      }

      setSelectedTemplateId(newTemplateId);

      // Instant restore from cache if target template was previously generated
      const cached = templateCacheRef.current.get(newTemplateId);
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
        const meta = (visit?.metadata || {}) as Record<string, unknown>;
        fetch(`/api/encounters/${visitId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            encounter_note: cached.generatedNote,
            patient_letter: cached.letter,
            metadata: { ...meta, template_id: newTemplateId },
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
        const meta = (visit.metadata || {}) as Record<string, unknown>;
        fetch(`/api/encounters/${visitId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            metadata: { ...meta, template_id: newTemplateId },
          }),
        }).catch(() => {});
      }

      try {
        for (let attempt = 0; attempt <= CLIENT_MAX_RETRIES; attempt++) {
          if (attempt > 0) {
            console.warn(
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

            const reader = res.body?.getReader();
            if (!reader) throw new Error("generation_failed");

            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });

              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";

              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const jsonStr = line.slice(6);
                if (!jsonStr) continue;

                try {
                  const event = JSON.parse(jsonStr);

                  if (event.type === "streaming_start") {
                    setStreamedSections([]);
                  } else if (event.type === "section") {
                    setStreamedSections((prev) => [
                      ...prev,
                      {
                        id: event.id,
                        title: event.title,
                        content: event.content,
                      },
                    ]);
                  } else if (event.type === "complete") {
                    templateCacheRef.current.set(newTemplateId, {
                      generatedNote: event.generatedNote,
                      letter: event.letter || "",
                    });
                    setGeneratedNoteHtml(event.generatedNote);
                    setVisit((prev) =>
                      prev
                        ? {
                            ...prev,
                            encounter_note: event.generatedNote,
                            patient_letter: event.letter,
                          }
                        : prev,
                    );
                  } else if (event.type === "error") {
                    throw new Error(event.error);
                  }
                } catch (parseErr) {
                  if (
                    parseErr instanceof Error &&
                    parseErr.message !== "Unexpected end of JSON input"
                  ) {
                    throw parseErr;
                  }
                }
              }
            }

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
        const cachedPrev = templateCacheRef.current.get(previousTemplateId);
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
          const meta = (visit.metadata || {}) as Record<string, unknown>;
          fetch(`/api/encounters/${visitId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              metadata: { ...meta, template_id: previousTemplateId },
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
    ],
  );

  /** Initialize state from fetched visit data */
  // Poll for server-side generation completion when page loads mid-generation
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // Clean up polling on unmount
  useEffect(() => stopPolling, [stopPolling]);

  const initFromVisit = useCallback((data: Encounter) => {
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
      templateCacheRef.current.set(tid, {
        generatedNote: data.encounter_note,
        letter: data.patient_letter || "",
      });
    }
    // Polling for "processing" status is handled by the reactive useEffect below
  }, []);

  // Reactive polling: auto-poll when visit.status is "processing" and SSE isn't active
  const POLL_TIMEOUT_MS = 90_000;
  useEffect(() => {
    if (visit?.status !== "processing" || isStreaming) {
      stopPolling();
      return;
    }
    const pollStart = Date.now();
    pollingRef.current = setInterval(async () => {
      // Timeout — server likely failed; reset to "started" so user can retry
      if (Date.now() - pollStart > POLL_TIMEOUT_MS) {
        stopPolling();
        setVisit((prev) =>
          prev ? { ...prev, status: "started" as const } : prev,
        );
        fetch(`/api/encounters/${visitId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "started" }),
        }).catch(() => {});
        window.dispatchEvent(
          new CustomEvent("encounter-update", {
            detail: { id: visitId, status: "started" },
          }),
        );
        return;
      }
      try {
        const res = await fetch(`/api/encounters/${visitId}`);
        if (!res.ok) return;
        const updated: Encounter = await res.json();
        if (updated.encounter_note || updated.status !== "processing") {
          stopPolling();
          setVisit(updated);
          if (updated.encounter_note) {
            setGeneratedNoteHtml(updated.encounter_note);
            const tid =
              ((updated.metadata as Record<string, unknown>)
                ?.template_id as string) || DEFAULT_TEMPLATE_ID;
            templateCacheRef.current.set(tid, {
              generatedNote: updated.encounter_note,
              letter: updated.patient_letter || "",
            });
          }
          if (updated.title) updateTitleRef.current(updated.title);
          window.dispatchEvent(
            new CustomEvent("encounter-update", {
              detail: {
                id: visitId,
                status: updated.status,
                ...(updated.title ? { title: updated.title } : {}),
              },
            }),
          );
        }
      } catch {
        /* silent — retry next interval */
      }
    }, 3000);
    return () => stopPolling();
  }, [visit?.status, isStreaming, visitId, setVisit, stopPolling]);

  // Calculate content metrics for timer estimation
  // Note: fileCount and imageCount are not available in this hook yet
  // They should be passed from the page component for more accurate estimation
  const contentMetrics = useMemo(
    () => ({
      transcriptLength: visit?.raw_text?.length || 0,
      doctorNotesLength: doctorNotes.length,
      fileCount: 0, // TODO: Pass files from page component
      imageCount: 0, // TODO: Pass files from page component
    }),
    [visit?.raw_text, doctorNotes],
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
    isRegenerating,
    streamedSections,
    streamingSectionIds,
    streamingSectionLabels,
    audioBlob,
    hasActiveRecording,
    recordingBarRef,
    syncTitle,
    initFromVisit,
    handleRecordingComplete,
    handleRecordingStateChange,
    handleGenerate,
    handleLanguageChange,
    handleTemplateChange,
    handleRegenerate,
    handleAdjustGenerate,
    timerState,
  };
}
