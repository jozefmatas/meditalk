"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Encounter, SupportedLanguage } from "@/lib/types";
import type { EncounterFile } from "@/components/encounters/files-panel";
import {
  type RecordingBarRef,
  audioMimeToExt,
} from "@/components/encounters/recording-bar";
import type { NoteSection } from "@/lib/parse-note-sections";
import {
  DEFAULT_TEMPLATE_ID,
  getPreferredTemplateId,
  setPreferredTemplateId,
} from "@/lib/templates";
import { uploadToStorage } from "@/lib/supabase/upload";

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

  // Navigation guard state
  const router = useRouter();
  const [navDialogOpen, setNavDialogOpen] = useState(false);
  const pendingNavUrlRef = useRef<string | null>(null);

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

  // Prevent accidental navigation during generation
  useEffect(() => {
    if (!isGenerating) return;

    // Tab close / page refresh — browser shows native "Leave site?" dialog
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    // Client-side link clicks — show custom dialog instead of navigating
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as Element).closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href === "#") return;
      try {
        const url = new URL(href, location.origin);
        if (
          url.origin === location.origin &&
          url.pathname !== location.pathname
        ) {
          e.preventDefault();
          e.stopPropagation();
          pendingNavUrlRef.current = href;
          setNavDialogOpen(true);
        }
      } catch {
        // invalid URL, ignore
      }
    };
    document.addEventListener("click", handleClick, true);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleClick, true);
    };
  }, [isGenerating]);

  const handleConfirmLeave = useCallback(() => {
    setNavDialogOpen(false);
    const url = pendingNavUrlRef.current;
    pendingNavUrlRef.current = null;
    if (url) router.push(url);
  }, [router]);

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

  const handleRecordingComplete = useCallback(
    async (blob: Blob) => {
      setAudioBlob(blob);

      // Upload directly to Supabase Storage (bypasses Vercel 4.5 MB limit)
      try {
        // Convert to WAV for reliable ElevenLabs compatibility
        // (MediaRecorder m4a/webm blobs can have malformed containers)
        let uploadBlob = blob;
        let fileName = `recording${audioMimeToExt(blob.type || "audio/webm")}`;
        let contentType = blob.type || "audio/webm";

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
      const finalized = await recordingBarRef.current?.finalize();
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
          // Convert to WAV for reliable ElevenLabs compatibility
          let uploadBlob = blobToProcess;
          let fileName = `recording${audioMimeToExt(blobToProcess.type || "audio/webm")}`;
          let uploadType = blobToProcess.type || "audio/webm";

          try {
            const { convertToWav } = await import("@/lib/audio/convert-to-wav");
            uploadBlob = await convertToWav(blobToProcess);
            fileName = "recording.wav";
            uploadType = "audio/wav";
          } catch {
            // Fall back to original
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

        // Generate note via SSE streaming (with client-side retry for transient errors)
        let completedEvent: Record<string, unknown> | null = null;

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

            break; // Stream completed successfully
          } catch (err) {
            if (isTransientError(err) && attempt < CLIENT_MAX_RETRIES) {
              continue;
            }
            throw err;
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
        // Use structured error keys for i18n translation
        const msg = err instanceof Error ? err.message : "";
        const errorKey =
          msg === "insufficient_context" || msg === "save_failed"
            ? msg
            : isTransientError(err)
              ? "network_error"
              : "generation_failed";
        setError(errorKey);
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
        templateCacheRef.current.set(tid, {
          generatedNote: data.encounter_note,
          letter: data.patient_letter || "",
        });
      }

      // Server-side generation still running — show processing overlay and poll
      if (data.status === "processing" && !data.encounter_note) {
        setIsGenerating(true);
        setIsStreaming(false);
        stopPolling();
        const pollStart = Date.now();
        const POLL_TIMEOUT_MS = 90_000; // give up after 90s
        pollingRef.current = setInterval(async () => {
          // Timeout — server likely failed; reset to "started" so user can retry
          if (Date.now() - pollStart > POLL_TIMEOUT_MS) {
            stopPolling();
            setIsGenerating(false);
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
              setIsGenerating(false);
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
      }
    },
    [visitId, setVisit, stopPolling],
  );

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
    navDialogOpen,
    setNavDialogOpen,
    handleConfirmLeave,
  };
}
