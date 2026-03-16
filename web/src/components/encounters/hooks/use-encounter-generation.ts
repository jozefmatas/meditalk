"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Encounter, SupportedLanguage } from "@/lib/types";
import type { EncounterFile } from "@/components/encounters/files-panel";
import type { RecordingBarRef } from "@/components/encounters/recording-bar";
import type { SoapSection } from "@/lib/parse-soap-sections";
import { getDefaultTemplate } from "@/lib/templates";

/** Module-level tracking of active generations so they survive component remounts. */
const activeGenerations = new Set<string>();

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

  // Template + generation
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    getDefaultTemplate().id,
  );
  const [doctorNotes, setDoctorNotes] = useState("");
  const [generatedNoteHtml, setGeneratedNoteHtml] = useState("");
  const [isGenerating, setIsGenerating] = useState(() =>
    activeGenerations.has(visitId),
  );
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [streamedSections, setStreamedSections] = useState<SoapSection[]>([]);

  // Audio recording — blob kept in memory until Generate
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
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

  // Prevent accidental navigation during processing
  useEffect(() => {
    if (!isGenerating) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isGenerating]);

  // Re-fetch encounter when a background generation completes
  useEffect(() => {
    const handler = (e: Event) => {
      const { visitId: doneId } = (e as CustomEvent).detail;
      if (doneId !== visitId) return;
      setIsGenerating(false);
      // Re-fetch encounter to pick up generated note + updated status
      (async () => {
        try {
          const res = await fetch(`/api/encounters/${visitId}`);
          if (!res.ok) return;
          const data: Encounter = await res.json();
          setVisit(data);
          if (data.title) updateTitleRef.current(data.title);
          if (data.soap_note) setGeneratedNoteHtml(data.soap_note);
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

  const handleRecordingComplete = useCallback(
    async (blob: Blob) => {
      setAudioBlob(blob);

      // Also upload to storage so it persists across refresh
      try {
        const file = new File([blob], "recording.webm", {
          type: blob.type || "audio/webm",
        });
        const formData = new FormData();
        formData.append("files", file);

        const res = await fetch(`/api/encounters/${visitId}/files`, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          console.error("Audio upload failed:", res.status);
          return;
        }

        const data = await res.json();
        const newFiles = (data.files as EncounterFile[]).map((f) => ({
          ...f,
          source: "recording" as const,
        }));
        setFiles((prev: EncounterFile[]) => [...prev, ...newFiles]);
      } catch (err) {
        console.error("Audio upload error:", err);
      }
    },
    [visitId, setFiles],
  );

  const handleRecordingStateChange = useCallback(
    (recordingState: "idle" | "recording" | "paused") => {
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
    [visitId, setVisit],
  );

  const handleGenerate = useCallback(async () => {
    if (!visitId) return;
    activeGenerations.add(visitId);
    setIsGenerating(true);
    setError(null);

    // Reflect processing state in sidebar + persist to DB
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

    // Capture values at call time so the chain works even after unmount
    const capturedTemplateId = selectedTemplateId;
    const capturedDoctorNotes = doctorNotes;
    const capturedTitle = titleRef.current;
    const capturedLanguage = generationLanguage;
    const finalized = recordingBarRef.current?.finalize();
    const blobToProcess = finalized?.blob ?? audioBlob;
    const streamingTranscript = finalized?.transcript ?? null;

    try {
      // Step 1: If there's a recorded audio blob, process it (chunk + embed)
      if (blobToProcess) {
        const audioFile = new File([blobToProcess], "recording.webm", {
          type: blobToProcess.type,
        });
        const formData = new FormData();
        formData.append("file", audioFile);
        formData.append("language", capturedLanguage);
        formData.append("visitId", visitId);
        if (streamingTranscript) {
          formData.append("transcriptText", streamingTranscript);
        }

        const transcribeRes = await fetch("/api/process-audio", {
          method: "POST",
          body: formData,
        });

        if (!transcribeRes.ok) {
          const data = await transcribeRes.json();
          throw new Error(data.error || "Transcription failed");
        }

        const transcribeData = await transcribeRes.json();
        setVisit((prev) =>
          prev ? { ...prev, raw_text: transcribeData.transcriptText } : prev,
        );
        setAudioBlob(null);
      }

      // Step 2: Generate note from transcript + doctor notes
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitId,
          templateId: capturedTemplateId,
          doctorNotes: capturedDoctorNotes || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Generation failed");
      }

      const data = await res.json();
      setGeneratedNoteHtml(data.generatedNote);
      setVisit((prev) =>
        prev
          ? {
              ...prev,
              soap_note: data.generatedNote,
              patient_letter: data.letter,
            }
          : prev,
      );

      // Auto-set title if user hasn't provided one
      const autoTitle = !capturedTitle.trim() ? data.suggestedTitle : null;
      const patchBody: Record<string, string> = { status: "to_review" };
      if (autoTitle) patchBody.title = autoTitle;

      // Auto-transition to review (+ title if generated)
      await fetch(`/api/encounters/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      if (autoTitle) updateTitleRef.current(autoTitle);
      setVisit((prev) => (prev ? { ...prev, status: "to_review" } : prev));
      window.dispatchEvent(
        new CustomEvent("encounter-update", {
          detail: {
            id: visitId,
            status: "to_review",
            ...(autoTitle ? { title: autoTitle } : {}),
          },
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      activeGenerations.delete(visitId);
      setIsGenerating(false);
      // Notify any remounted instances that generation is done
      window.dispatchEvent(
        new CustomEvent("generation-done", { detail: { visitId } }),
      );
    }
  }, [
    visitId,
    selectedTemplateId,
    doctorNotes,
    generationLanguage,
    audioBlob,
    setVisit,
    setError,
  ]);

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

  // Persist template selection
  const handleTemplateChange = useCallback(
    (id: string) => {
      setSelectedTemplateId(id);
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

      // Cache current template's note before switching
      if (visit?.soap_note) {
        templateCacheRef.current.set(selectedTemplateId, {
          generatedNote: visit.soap_note,
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
                soap_note: cached.generatedNote,
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
            soap_note: cached.generatedNote,
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
          const data = await res.json();
          throw new Error(data.error || "Regeneration failed");
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from the buffer
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6);
            if (!jsonStr) continue;

            try {
              const event = JSON.parse(jsonStr);

              if (event.type === "section") {
                setStreamedSections((prev) => [
                  ...prev,
                  { id: event.id, title: event.title, content: event.content },
                ]);
              } else if (event.type === "complete") {
                // Cache the newly generated note
                templateCacheRef.current.set(newTemplateId, {
                  generatedNote: event.generatedNote,
                  letter: event.letter || "",
                });
                setGeneratedNoteHtml(event.generatedNote);
                setVisit((prev) =>
                  prev
                    ? {
                        ...prev,
                        soap_note: event.generatedNote,
                        patient_letter: event.letter,
                      }
                    : prev,
                );
              } else if (event.type === "error") {
                throw new Error(event.error);
              }
            } catch (parseErr) {
              // If it's a rethrown Error from the event handler, propagate it
              if (
                parseErr instanceof Error &&
                parseErr.message !== "Unexpected end of JSON input"
              ) {
                throw parseErr;
              }
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Regeneration failed");
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
    if (data.soap_note) {
      setGeneratedNoteHtml(data.soap_note);
      // Seed cache with the initially loaded template's note
      const tid = (meta?.template_id as string) || getDefaultTemplate().id;
      templateCacheRef.current.set(tid, {
        generatedNote: data.soap_note,
        letter: data.patient_letter || "",
      });
    }
  }, []);

  return {
    generationLanguage,
    selectedTemplateId,
    doctorNotes,
    setDoctorNotes,
    generatedNoteHtml,
    setGeneratedNoteHtml,
    isGenerating,
    isRegenerating,
    streamedSections,
    audioBlob,
    setAudioBlob,
    recordingBarRef,
    syncTitle,
    initFromVisit,
    handleRecordingComplete,
    handleRecordingStateChange,
    handleGenerate,
    handleLanguageChange,
    handleTemplateChange,
    handleRegenerate,
  };
}
