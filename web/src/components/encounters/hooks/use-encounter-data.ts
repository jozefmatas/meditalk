"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Encounter } from "@/lib/types";
import type { EncounterFile } from "@/lib/encounters/file-state";
import { GENERATION_STALE_THRESHOLD_MS } from "@/lib/extraction/constants";
import { on } from "@/lib/events";
import { patchEncounter } from "@/lib/encounters/api";
import { logger } from "@/lib/logger";

interface UseEncounterDataOptions {
  visitId: string;
  locale: string;
  router: { push: (url: string) => void };
  onLoaded?: (data: Encounter) => void;
}

export function useEncounterData({
  visitId,
  locale,
  router,
  onLoaded,
}: UseEncounterDataOptions) {
  const [visit, setVisit] = useState<Encounter | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Files
  const [files, setFilesState] = useState<EncounterFile[]>([]);

  /** Update files state and keep visit.metadata.files in sync so auto-save doesn't overwrite */
  const setFiles = useCallback(
    (
      update: EncounterFile[] | ((prev: EncounterFile[]) => EncounterFile[]),
    ) => {
      setFilesState((prev) => {
        const next = typeof update === "function" ? update(prev) : update;
        setVisit((v) => {
          if (!v) return v;
          return { ...v, metadata: { ...v.metadata, files: next } } as Encounter;
        });
        return next;
      });
    },
    [],
  );

  // Stable ref for onLoaded callback
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  // Fetch visit data
  useEffect(() => {
    const fetchVisit = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/encounters/${visitId}`);
        if (!res.ok) throw new Error("Visit not found");

        const data: Encounter = await res.json();
        // ── Status auto-corrections ──────────────────────────────
        // Fix inconsistent states caused by server crashes, browser kills,
        // or legacy bugs. Each correction is logged for observability.

        // Recording state isn't persisted across page loads — reset to started
        if (data.status === "recording") {
          logger.debug(
            `[encounter-data] Auto-correcting status: recording → started (visit=${visitId})`,
          );
          data.status = "started";
          patchEncounter(visitId, { status: "started" });
        }

        // Processing: server-side generation may still be running
        if (data.status === "processing") {
          if (data.encounter_note) {
            // Server finished but status wasn't updated (pre-fix encounters)
            logger.debug(
              `[encounter-data] Auto-correcting status: processing → to_review (note exists, visit=${visitId})`,
            );
            data.status = "to_review";
            patchEncounter(visitId, { status: "to_review" });
          } else {
            // No note — check if the generation is stale (server died mid-flight).
            const pending = data.metadata?.generation_pending;
            if (pending?.startedAt) {
              const elapsed =
                Date.now() - new Date(pending.startedAt).getTime();
              if (elapsed > GENERATION_STALE_THRESHOLD_MS) {
                logger.warn(
                  `[encounter-data] Stale generation detected: processing → started (elapsed=${Math.round(elapsed / 1000)}s, visit=${visitId})`,
                );
                data.status = "started";
                patchEncounter(visitId, { status: "started" });
              }
            }
            // else: server may still be generating — keep "processing", polling hook will handle
          }
        }

        // Started but note exists: auto-resume bug corrupted the status
        if (data.status === "started" && data.encounter_note) {
          logger.debug(
            `[encounter-data] Auto-correcting status: started → to_review (note exists, visit=${visitId})`,
          );
          data.status = "to_review";
          patchEncounter(visitId, { status: "to_review" });
        }
        setVisit(data);

        if (data.metadata?.files) {
          setFilesState(data.metadata.files as EncounterFile[]);
        }

        onLoadedRef.current?.(data);
      } catch {
        setError("Failed to load visit");
      } finally {
        setIsLoading(false);
      }
    };

    fetchVisit();
  }, [visitId]);

  // React to sidebar actions (delete, mark complete) on the current encounter
  useEffect(() => {
    const cleanupDelete = on("encounter-delete", ({ id }) => {
      if (id === visitId) {
        const base = locale === "sk" ? "" : `/${locale}`;
        router.push(base || "/");
      }
    });
    const cleanupUpdate = on("encounter-update", (detail) => {
      if (detail.id !== visitId) return;
      if (detail.status !== undefined) {
        setVisit((prev) => (prev ? { ...prev, status: detail.status! } : prev));
      }
    });
    return () => {
      cleanupDelete();
      cleanupUpdate();
    };
  }, [visitId, router, locale]);

  /** Re-fetch the encounter from the API and update both visit and files state. */
  const refreshEncounter = useCallback(async () => {
    try {
      const res = await fetch(`/api/encounters/${visitId}`);
      if (!res.ok) return;
      const data: Encounter = await res.json();
      setVisit(data);
      if (data.metadata?.files) {
        setFilesState(data.metadata.files as EncounterFile[]);
      }
    } catch {
      // Silent fail — refresh is best-effort
    }
  }, [visitId]);

  return {
    visit,
    setVisit,
    isLoading,
    error,
    setError,
    files,
    setFiles,
    refreshEncounter,
  };
}
