"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Encounter, EncounterListResponse } from "@/lib/types";
import { normalizeStatus } from "@/lib/encounters/normalize-status";
import { emit, on } from "@/lib/events";
import { patchEncounter } from "@/lib/encounters/api";

const SIDEBAR_LIMIT = 20;

function normalizeEncounters(encounters: Encounter[]): Encounter[] {
  return encounters.map((v) => ({ ...v, status: normalizeStatus(v.status) }));
}

// ── Module-level cache ──────────────────────────────────────────────
// AppShell (and therefore the sidebar) remounts on every page navigation
// because it lives inside each page component, not in a shared layout.
// This cache lets the hook initialise with the previous data so there is
// no flash of skeleton / empty state between navigations.
let _cache: { visits: Encounter[]; total: number } | null = null;

/** @internal — only exported for tests */
export function _resetCache() {
  _cache = null;
}

export function useSidebarEncounters() {
  const [visits, setVisitsRaw] = useState<Encounter[]>(
    () => _cache?.visits ?? [],
  );
  const [isLoading, setIsLoading] = useState(_cache === null);
  const [total, setTotalRaw] = useState(() => _cache?.total ?? 0);
  const pageRef = useRef(1);
  const loadingRef = useRef(false);
  /** IDs of encounters with a pending DELETE — filtered out of refetch results
   *  so the optimistic removal doesn't get overwritten by a race. */
  const pendingDeletesRef = useRef<Set<string>>(new Set());

  // Wrappers that keep the module cache in sync with React state
  const setVisits: typeof setVisitsRaw = useCallback((update) => {
    setVisitsRaw((prev) => {
      const next = typeof update === "function" ? update(prev) : update;
      if (_cache) _cache.visits = next;
      else _cache = { visits: next, total: 0 };
      return next;
    });
  }, []);

  const setTotal: typeof setTotalRaw = useCallback((update) => {
    setTotalRaw((prev) => {
      const next = typeof update === "function" ? update(prev) : update;
      if (_cache) _cache.total = next;
      else _cache = { visits: [], total: next };
      return next;
    });
  }, []);

  const fetchVisits = useCallback(
    async (pageNum: number) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      // Only show skeleton on the very first load (no cached data)
      if (_cache === null) setIsLoading(true);
      try {
        const params = new URLSearchParams({
          page: pageNum.toString(),
          limit: SIDEBAR_LIMIT.toString(),
        });
        const res = await fetch(`/api/encounters?${params}`);
        if (!res.ok) throw new Error("Failed to fetch visits");

        const data: EncounterListResponse = await res.json();

        let normalized = normalizeEncounters(data.encounters);
        // Strip any encounters with a pending delete so the optimistic removal sticks
        if (pendingDeletesRef.current.size > 0) {
          normalized = normalized.filter(
            (v) => !pendingDeletesRef.current.has(v.id),
          );
        }
        if (pageNum === 1) {
          setVisits(normalized);
        } else {
          setVisits((prev) => [...prev, ...normalized]);
        }
        setTotal(data.total);
        pageRef.current = pageNum;
      } catch {
        // Silently fail in sidebar — visits are still accessible via search
      } finally {
        loadingRef.current = false;
        setIsLoading(false);
      }
    },
    [setVisits, setTotal],
  );

  // Fetch once on mount — fetchVisits drives loading/results state from a
  // network call, which is the legitimate external-source use of useEffect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchVisits(1);
  }, [fetchVisits]);

  // Live-update a visit when the detail page changes title or status,
  // and add new encounters when created via sidebar-refresh
  useEffect(() => {
    const cleanupUpdate = on("encounter-update", (detail) => {
      setVisits((prev) =>
        prev.map((v) => {
          if (v.id !== detail.id) return v;
          const updated = { ...v };
          if (detail.title !== undefined) updated.title = detail.title;
          if (detail.status !== undefined) updated.status = detail.status;
          return updated;
        }),
      );
    });
    const cleanupRefresh = on("sidebar-refresh", ({ encounter }) => {
      const normalized = normalizeEncounters([encounter])[0];
      setVisits((prev) => {
        // Avoid duplicates (e.g. if the event fires twice)
        if (prev.some((v) => v.id === normalized.id)) return prev;
        return [normalized, ...prev];
      });
      setTotal((prev) => prev + 1);
    });
    return () => {
      cleanupUpdate();
      cleanupRefresh();
    };
  }, [setVisits, setTotal]);

  const loadMore = useCallback(() => {
    if (loadingRef.current) return;
    fetchVisits(pageRef.current + 1);
  }, [fetchVisits]);

  const deleteVisit = useCallback(
    async (visitId: string) => {
      // Mark as pending so concurrent refetches don't resurrect it
      pendingDeletesRef.current.add(visitId);

      // Optimistic update
      setVisits((prev) => prev.filter((v) => v.id !== visitId));
      setTotal((prev) => prev - 1);
      // Notify detail page so it can navigate to the encounters list
      emit("encounter-delete", { id: visitId });

      try {
        const res = await fetch(`/api/encounters/${visitId}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("Failed to delete");
      } catch {
        // Revert on failure
        pendingDeletesRef.current.delete(visitId);
        fetchVisits(1);
        return;
      }
      pendingDeletesRef.current.delete(visitId);
    },
    [fetchVisits, setVisits, setTotal],
  );

  const markComplete = useCallback(
    async (visitId: string) => {
      setVisits((prev) =>
        prev.map((v) =>
          v.id === visitId ? { ...v, status: "completed" as const } : v,
        ),
      );
      // Notify detail page so it can update its local state
      emit("encounter-update", { id: visitId, status: "completed" });

      const res = await patchEncounter(visitId, { status: "completed" });
      if (!res?.ok) {
        fetchVisits(1);
      }
    },
    [fetchVisits, setVisits],
  );

  const hasMore = visits.length < total;

  return { visits, isLoading, hasMore, loadMore, deleteVisit, markComplete };
}
