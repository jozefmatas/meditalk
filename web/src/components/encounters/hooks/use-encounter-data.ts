"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Encounter, EncounterStatus } from "@/lib/types";
import type { EncounterFile } from "@/components/encounters/files-panel";

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
          const meta = (v.metadata ?? {}) as Record<string, unknown>;
          return { ...v, metadata: { ...meta, files: next } } as Encounter;
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
        // Recording state isn't persisted across page loads — reset to started
        if (data.status === "recording") {
          data.status = "started";
          fetch(`/api/encounters/${visitId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "started" }),
          }).catch(() => {});
        }
        // Processing: server-side generation may still be running
        if (data.status === "processing") {
          if (data.encounter_note) {
            // Server finished but status wasn't updated (pre-fix encounters) — auto-correct
            data.status = "to_review";
            fetch(`/api/encounters/${visitId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "to_review" }),
            }).catch(() => {});
          }
          // else: server is still generating — keep "processing", generation hook will poll
        }
        // Started but note exists: auto-resume bug corrupted the status — auto-correct
        if (data.status === "started" && data.encounter_note) {
          data.status = "to_review";
          fetch(`/api/encounters/${visitId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "to_review" }),
          }).catch(() => {});
        }
        setVisit(data);

        const meta = data.metadata as Record<string, unknown>;
        if (meta?.files) {
          setFilesState(meta.files as EncounterFile[]);
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
    const handleDelete = (e: Event) => {
      const { id } = (e as CustomEvent<{ id: string }>).detail;
      if (id === visitId) {
        const base = locale === "sk" ? "" : `/${locale}`;
        router.push(base || "/");
      }
    };
    const handleUpdate = (e: Event) => {
      const detail = (
        e as CustomEvent<{
          id: string;
          status?: EncounterStatus;
        }>
      ).detail;
      if (detail.id !== visitId) return;
      if (detail.status !== undefined) {
        setVisit((prev) => (prev ? { ...prev, status: detail.status! } : prev));
      }
    };
    window.addEventListener("encounter-delete", handleDelete);
    window.addEventListener("encounter-update", handleUpdate);
    return () => {
      window.removeEventListener("encounter-delete", handleDelete);
      window.removeEventListener("encounter-update", handleUpdate);
    };
  }, [visitId, router, locale]);

  /** Re-fetch the encounter from the API and update both visit and files state. */
  const refreshEncounter = useCallback(async () => {
    try {
      const res = await fetch(`/api/encounters/${visitId}`);
      if (!res.ok) return;
      const data: Encounter = await res.json();
      setVisit(data);
      const meta = data.metadata as Record<string, unknown>;
      if (meta?.files) {
        setFilesState(meta.files as EncounterFile[]);
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
