"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Encounter, SupportedLanguage } from "@/lib/types";
import type { EncounterFile } from "@/components/encounters/files-panel";
import {
  type RecordingBarRef,
  audioMimeToExt,
} from "@/components/encounters/recording-bar";
import type { NoteSection } from "@/lib/parse-note-sections";
import { getDefaultTemplate } from "@/lib/templates";
import { uploadToStorage } from "@/lib/supabase/upload";

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
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedSections, setStreamedSections] = useState<NoteSection[]>([]);
  // Template section IDs received from streaming_start — used for skeleton rendering
  const [streamingSectionIds, setStreamingSectionIds] = useState<string[]>([]);
  const [streamingSectionLabels, setStreamingSectionLabels] = useState<
    Record<string, string>
  >({});

  // Audio recording — blob kept in memory for canGenerate check
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  // Storage path of the uploaded audio (set by handleRecordingComplete or FilesPanel)
  const [audioStoragePath, setAudioStoragePath] = useState<string | null>(null);
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

      // Upload directly to Supabase Storage (bypasses Vercel 4.5 MB limit)
      try {
        // Convert WebM/OGG to WAV for reliable ElevenLabs compatibility
        let uploadBlob = blob;
        let fileName = `recording${audioMimeToExt(blob.type || "audio/webm")}`;
        let contentType = blob.type || "audio/webm";

        if (contentType.includes("webm") || contentType.includes("ogg")) {
          try {
            const { convertToWav } = await import("@/lib/audio/convert-to-wav");
            uploadBlob = await convertToWav(blob);
            fileName = "recording.wav";
            contentType = "audio/wav";
          } catch (convErr) {
            console.warn(
              "[recording] WAV conversion failed, uploading original:",
              convErr,
            );
          }
        }

        const { path, fileId } = await uploadToStorage(uploadBlob, fileName, {
          encounterId: visitId,
        });

        setAudioStoragePath(path);

        // Register file metadata with the API (small JSON, no file bytes)
        const res = await fetch(`/api/encounters/${visitId}/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            files: [
              {
                id: fileId,
                name: fileName,
                size: uploadBlob.size,
                type: contentType,
                path,
                source: "recording",
              },
            ],
          }),
        });

        if (!res.ok) {
          console.error("Audio metadata registration failed:", res.status);
          return;
        }

        const data = await res.json();
        setFiles((prev: EncounterFile[]) => [
          ...prev,
          ...(data.files as EncounterFile[]),
        ]);
      } catch (err) {
        console.error("Audio upload error:", err);
      }
    },
    [visitId, setFiles],
  );

  const handleRecordingStateChange = useCallback(
    (recordingState: "idle" | "recording" | "paused") => {
      setHasActiveRecording(recordingState !== "idle");
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

  const handleGenerate = useCallback(
    async (options?: { sendAsEmail?: boolean }) => {
      if (!visitId) return;
      activeGenerations.add(visitId);
      setIsGenerating(true);
      setIsStreaming(false);
      setStreamedSections([]);
      setStreamingSectionIds([]);
      setStreamingSectionLabels({});
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
      const capturedAudioStoragePath = audioStoragePath;
      const finalized = recordingBarRef.current?.finalize();
      const blobToProcess = finalized?.blob ?? audioBlob;
      const streamingTranscript = finalized?.transcript ?? null;

      try {
        // If there's a recorded audio that hasn't been uploaded yet AND we don't
        // have a streaming transcript, upload now as fallback.
        if (
          blobToProcess &&
          !capturedAudioStoragePath &&
          !streamingTranscript
        ) {
          // Convert WebM/OGG to WAV for reliable ElevenLabs compatibility
          let uploadBlob = blobToProcess;
          const blobMime = blobToProcess.type || "audio/webm";
          let fileName = `recording${audioMimeToExt(blobMime)}`;
          let uploadType = blobMime;

          if (blobMime.includes("webm") || blobMime.includes("ogg")) {
            try {
              const { convertToWav } =
                await import("@/lib/audio/convert-to-wav");
              uploadBlob = await convertToWav(blobToProcess);
              fileName = "recording.wav";
              uploadType = "audio/wav";
            } catch {
              // Fall back to original
            }
          }

          const result = await uploadToStorage(uploadBlob, fileName, {
            encounterId: visitId,
          });
          await fetch(`/api/encounters/${visitId}/files`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              files: [
                {
                  id: crypto.randomUUID(),
                  name: fileName,
                  size: uploadBlob.size,
                  type: uploadType,
                  path: result.path,
                  source: "recording",
                },
              ],
            }),
          });
        }

        setAudioBlob(null);
        setAudioStoragePath(null);

        // Generate note via SSE streaming
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            visitId,
            templateId: capturedTemplateId,
            doctorNotes: capturedDoctorNotes || undefined,
            transcriptText: streamingTranscript || undefined,
          }),
        });

        if (!res.ok) {
          let message = "Generation failed";
          try {
            const data = await res.json();
            message = data.error || message;
          } catch {
            /* non-JSON response */
          }
          throw new Error(message);
        }

        // Read SSE stream
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let buffer = "";
        let completedEvent: Record<string, unknown> | null = null;

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
                // Switch from full-screen overlay to streaming sections view
                // Also reset streamed sections (handles server-side retries)
                setIsStreaming(true);
                setStreamedSections([]);
                setStreamingSectionIds(event.sectionIds);
                setStreamingSectionLabels(event.sectionLabels);
              } else if (event.type === "section") {
                setStreamedSections((prev) => [
                  ...prev,
                  { id: event.id, title: event.title, content: event.content },
                ]);
              } else if (event.type === "complete") {
                completedEvent = event;
                setGeneratedNoteHtml(event.generatedNote);
                setVisit((prev) => {
                  if (!prev) return prev;
                  const existingMeta = (prev.metadata ?? {}) as Record<
                    string,
                    unknown
                  >;
                  return {
                    ...prev,
                    soap_note: event.generatedNote,
                    patient_letter: event.letter,
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

        // Handle post-generation (title, status transition) using completed event
        if (completedEvent) {
          const autoTitle = !capturedTitle.trim()
            ? (completedEvent.suggestedTitle as string)
            : null;
          const patchBody: Record<string, string> = { status: "to_review" };
          if (autoTitle) patchBody.title = autoTitle;

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

          if (options?.sendAsEmail) {
            fetch("/api/send-note-email", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ visitId }),
            }).catch(() => {});
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Generation failed");
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
      } finally {
        activeGenerations.delete(visitId);
        setIsGenerating(false);
        setIsStreaming(false);
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
      audioStoragePath,
      setVisit,
      setError,
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

              if (event.type === "streaming_start") {
                // Reset streamed sections on retry
                setStreamedSections([]);
              } else if (event.type === "section") {
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
  };
}
