"use client";

import { useEffect, useCallback, useRef } from "react";
import type { Encounter } from "@/lib/types";
import { DEFAULT_TEMPLATE_ID } from "@/lib/templates";
import { emit, on } from "@/lib/events";
import { patchEncounterStatus } from "@/lib/encounters/api";

const POLL_TIMEOUT_MS = 180_000; // 3 min — matches GENERATION_STALE_THRESHOLD_MS
const POLL_INTERVAL_MS = 3_000;

interface UseGenerationPollingOptions {
  visitId: string;
  visit: Encounter | null;
  setVisit: React.Dispatch<React.SetStateAction<Encounter | null>>;
  isStreaming: boolean;
  setIsGenerating: (v: boolean) => void;
  setIsStreaming: (v: boolean) => void;
  updateTitleRef: React.RefObject<(title: string) => void>;
  setGeneratedNoteHtml: (html: string) => void;
  setCachedTemplate: (
    templateId: string,
    data: { generatedNote: string },
  ) => void;
  /** Called when the polling loop times out without finding a completed generation.
   *  Used by use-encounter-generation to auto-resume lost generations. */
  onPollTimeout?: () => void;
}

/**
 * Reactive polling for server-side generation recovery.
 *
 * Auto-polls when visit.status="processing" and SSE isn't active (e.g. page
 * loaded mid-generation, or connection dropped). Also listens for the
 * "generation-done" event to re-fetch the encounter when background generation
 * completes.
 */
export function useGenerationPolling({
  visitId,
  visit,
  setVisit,
  isStreaming,
  setIsGenerating,
  setIsStreaming,
  updateTitleRef,
  setGeneratedNoteHtml,
  setCachedTemplate,
  onPollTimeout,
}: UseGenerationPollingOptions): void {
  const onPollTimeoutRef = useRef(onPollTimeout);
  useEffect(() => {
    onPollTimeoutRef.current = onPollTimeout;
  });

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // Clean up polling on unmount
  useEffect(() => stopPolling, [stopPolling]);

  // Re-fetch encounter when a background generation completes
  useEffect(() => {
    return on("generation-done", (detail) => {
      if (detail.visitId !== visitId) return;

      (async () => {
        try {
          const res = await fetch(`/api/encounters/${visitId}`);
          if (!res.ok) return;
          const data: Encounter = await res.json();
          setVisit(data);
          setIsGenerating(false);
          setIsStreaming(false);
          if (data.title) updateTitleRef.current(data.title);
          if (data.encounter_note) setGeneratedNoteHtml(data.encounter_note);
        } catch {
          /* silent */
        }
      })();
    });
  }, [
    visitId,
    setVisit,
    setIsGenerating,
    setIsStreaming,
    updateTitleRef,
    setGeneratedNoteHtml,
  ]);

  // Reactive polling: auto-poll when visit.status is "processing" and SSE isn't active
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
        setIsGenerating(false);
        setIsStreaming(false);
        setVisit((prev) =>
          prev ? { ...prev, status: "started" as const } : prev,
        );
        patchEncounterStatus(visitId, "started");
        // Notify parent — allows auto-resume of lost generations
        onPollTimeoutRef.current?.();
        return;
      }
      try {
        const res = await fetch(`/api/encounters/${visitId}`);
        if (!res.ok) return;
        const updated: Encounter = await res.json();
        if (updated.encounter_note || updated.status !== "processing") {
          stopPolling();
          setIsGenerating(false);
          setIsStreaming(false);
          setVisit(updated);
          if (updated.encounter_note) {
            setGeneratedNoteHtml(updated.encounter_note);
            const tid =
              ((updated.metadata as Record<string, unknown>)
                ?.template_id as string) || DEFAULT_TEMPLATE_ID;
            setCachedTemplate(tid, {
              generatedNote: updated.encounter_note,
            });
          }
          if (updated.title) updateTitleRef.current(updated.title);
          emit("encounter-update", {
            id: visitId,
            status: updated.status,
            ...(updated.title ? { title: updated.title } : {}),
          });
        }
      } catch {
        /* silent — retry next interval */
      }
    }, POLL_INTERVAL_MS);
    return () => stopPolling();
  }, [
    visit?.status,
    isStreaming,
    visitId,
    setVisit,
    setIsGenerating,
    setIsStreaming,
    stopPolling,
    setGeneratedNoteHtml,
    setCachedTemplate,
    updateTitleRef,
  ]);
}
