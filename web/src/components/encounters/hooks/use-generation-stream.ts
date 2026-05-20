"use client";

import { useState, useCallback, useEffect } from "react";
import type { NoteSection } from "@/lib/parse-note-sections";
import { parseSSEStream } from "@/lib/api/parse-sse-stream";
import {
  isTransientNetworkError,
  isTransientStatusCode,
} from "@/lib/api/is-transient-error";
import { on } from "@/lib/events";
import { generationTracker } from "@/lib/encounters/generation-tracker";
import { logger } from "@/lib/logger";

// ── Public re-exports ────────────────────────────────────────────

/** Check if a generation is already active for this visit. */
export function isGenerationActive(visitId: string): boolean {
  return generationTracker.isActive(visitId);
}

// ── Constants ─────────────────────────────────────────────────────

const CLIENT_MAX_RETRIES = 2;
const CLIENT_RETRY_DELAY = 3000;

/** Classify whether an error is transient (worth retrying) or permanent. */
function isTransientError(err: unknown, status?: number): boolean {
  if (status && isTransientStatusCode(status)) return true;
  return isTransientNetworkError(err);
}

// ── Public types ──────────────────────────────────────────────────

export interface ExecuteStreamParams {
  url: string;
  body: Record<string, unknown>;
  /** Whether to retry on transient errors (default: true for /api/generate). */
  retry?: boolean;
  onStreamingStart?: (event: Record<string, unknown>) => void;
  onSection?: (event: Record<string, unknown>) => void;
  onComplete?: (event: Record<string, unknown>) => void;
}

export interface UseGenerationStreamReturn {
  isStreaming: boolean;
  isGenerating: boolean;
  streamedSections: NoteSection[];
  streamingSectionIds: string[];
  streamingSectionLabels: Record<string, string>;
  /** Current progress stage during source resolution (e.g. "preparing", "transcribing"). */
  progressStage: string | null;
  executeStream: (
    params: ExecuteStreamParams,
  ) => Promise<Record<string, unknown> | null>;
  resetStream: () => void;
  /** Restore streaming state from cache (SPA navigation / page refresh). */
  restoreFromCache: () => boolean;
}

// ── Hook ──────────────────────────────────────────────────────────

export function useGenerationStream(
  visitId: string,
): UseGenerationStreamReturn {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamedSections, setStreamedSections] = useState<NoteSection[]>([]);
  const [streamingSectionIds, setStreamingSectionIds] = useState<string[]>([]);
  const [streamingSectionLabels, setStreamingSectionLabels] = useState<
    Record<string, string>
  >({});
  const [progressStage, setProgressStage] = useState<string | null>(null);

  const resetStream = useCallback(() => {
    setStreamedSections([]);
    setStreamingSectionIds([]);
    setStreamingSectionLabels({});
    setIsStreaming(false);
    setProgressStage(null);
  }, []);

  const restoreFromCache = useCallback((): boolean => {
    const cached = generationTracker.getCache(visitId);
    if (cached && cached.sectionIds.length > 0) {
      setIsStreaming(true);
      setIsGenerating(true);
      setStreamedSections(cached.sections);
      setStreamingSectionIds(cached.sectionIds);
      setStreamingSectionLabels(cached.sectionLabels);
      return true;
    }
    return false;
  }, [visitId]);

  const executeStream = useCallback(
    async (
      params: ExecuteStreamParams,
    ): Promise<Record<string, unknown> | null> => {
      const { url, body, retry = true } = params;

      if (!generationTracker.start(visitId)) return null;

      setIsGenerating(true);
      setIsStreaming(false);
      resetStream();

      const ctx = {
        completedEvent: null as Record<string, unknown> | null,
        streamingStarted: false,
      };

      try {
        const maxRetries = retry ? CLIENT_MAX_RETRIES : 0;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (attempt > 0) {
            logger.warn(
              `[stream] Client retry ${attempt}/${maxRetries} for ${url}`,
            );
            await new Promise((r) => setTimeout(r, CLIENT_RETRY_DELAY));
            setIsStreaming(false);
            setStreamedSections([]);
            setStreamingSectionIds([]);
            setStreamingSectionLabels({});
          }

          try {
            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
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
              if (isTransientError(null, res.status) && attempt < maxRetries)
                continue;
              throw err;
            }

            if (!res.body) throw new Error("generation_failed");

            await parseSSEStream(res.body, {
              onProgress: (e) => {
                setProgressStage(e.stage);
              },
              onStreamingStart: (e) => {
                ctx.streamingStarted = true;
                setIsStreaming(true);
                setProgressStage(null);
                setStreamedSections([]);
                setStreamingSectionIds(e.sectionIds);
                setStreamingSectionLabels(e.sectionLabels);
                generationTracker.updateCache(visitId, {
                  sections: [],
                  sectionIds: e.sectionIds,
                  sectionLabels: e.sectionLabels,
                });
                params.onStreamingStart?.(e);
              },
              onSection: (e) => {
                const section = {
                  id: e.id,
                  title: e.title,
                  content: e.content,
                };
                setStreamedSections((prev) => [...prev, section]);
                const cached = generationTracker.getCache(visitId);
                generationTracker.updateCache(visitId, {
                  sections: [...(cached?.sections || []), section],
                });
                params.onSection?.(e);
              },
              onComplete: (event) => {
                ctx.completedEvent = event;
                params.onComplete?.(event);
              },
              onError: (error) => {
                throw new Error(error);
              },
            });

            break; // Stream completed successfully
          } catch (err) {
            // Once streaming started, don't retry — retrying would start a SECOND generation
            if (ctx.streamingStarted) break;
            if (isTransientError(err) && attempt < maxRetries) continue;
            throw err;
          }
        }

        return ctx.completedEvent;
      } finally {
        generationTracker.complete(visitId);
        setIsStreaming(false);
        setIsGenerating(false);
      }
    },
    [visitId, resetStream],
  );

  // Sync streaming state from the old async function's SSE reader when
  // recovering a generation started on a previous mount (SPA navigation).
  useEffect(() => {
    if (!isGenerating) return;

    const cleanupStream = on("streaming-update", (detail) => {
      if (detail.visitId !== visitId) return;
      setIsStreaming(true);
      setStreamedSections(detail.sections);
      setStreamingSectionIds(detail.sectionIds);
      setStreamingSectionLabels(detail.sectionLabels);
    });

    const cleanupDone = on("generation-done", (detail) => {
      if (detail.visitId !== visitId) return;
      setIsStreaming(false);
    });

    // Catch any updates that arrived between mount and this effect.
    // Reading from the generationTracker singleton is an external source.
    const cached = generationTracker.getCache(visitId);
    if (cached && cached.sectionIds.length > 0) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setIsStreaming(true);
      setStreamedSections(cached.sections);
      setStreamingSectionIds(cached.sectionIds);
      setStreamingSectionLabels(cached.sectionLabels);
      /* eslint-enable react-hooks/set-state-in-effect */
    }

    return () => {
      cleanupStream();
      cleanupDone();
    };
  }, [isGenerating, visitId]);

  return {
    isStreaming,
    isGenerating,
    streamedSections,
    streamingSectionIds,
    streamingSectionLabels,
    progressStage,
    executeStream,
    resetStream,
    restoreFromCache,
  };
}
