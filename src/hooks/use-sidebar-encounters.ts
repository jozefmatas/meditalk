"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import type { Encounter, EncounterListResponse, EncounterStatus } from "@/lib/types";

const SIDEBAR_LIMIT = 20;

/** Normalize legacy DB statuses (e.g. "completed" → "closed") */
function normalizeStatus(status: string): EncounterStatus {
  if (status === "completed") return "closed";
  return status as EncounterStatus;
}

function normalizeEncounters(encounters: Encounter[]): Encounter[] {
  return encounters.map((v) => ({ ...v, status: normalizeStatus(v.status) }));
}

export function useSidebarEncounters() {
  const pathname = usePathname();
  const [visits, setVisits] = useState<Encounter[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const pageRef = useRef(1);
  const loadingRef = useRef(false);

  const fetchVisits = useCallback(async (pageNum: number) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: pageNum.toString(),
        limit: SIDEBAR_LIMIT.toString(),
      });
      const res = await fetch(`/api/encounters?${params}`);
      if (!res.ok) throw new Error("Failed to fetch visits");

      const data: EncounterListResponse = await res.json();

      const normalized = normalizeEncounters(data.encounters);
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
  }, []);

  // Refetch on pathname change (catches new visit creation, navigation)
  useEffect(() => {
    pageRef.current = 1;
    fetchVisits(1);
  }, [pathname, fetchVisits]);

  // Live-update a visit when the detail page changes its title
  useEffect(() => {
    const handler = (e: Event) => {
      const { id, title } = (e as CustomEvent<{ id: string; title: string }>).detail;
      setVisits((prev) =>
        prev.map((v) => (v.id === id ? { ...v, title } : v))
      );
    };
    window.addEventListener("encounter-update", handler);
    return () => window.removeEventListener("encounter-update", handler);
  }, []);

  const loadMore = useCallback(() => {
    if (loadingRef.current) return;
    fetchVisits(pageRef.current + 1);
  }, [fetchVisits]);

  const deleteVisit = async (visitId: string) => {
    // Optimistic update
    setVisits((prev) => prev.filter((v) => v.id !== visitId));
    setTotal((prev) => prev - 1);

    try {
      const res = await fetch(`/api/encounters/${visitId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    } catch {
      // Revert on failure
      fetchVisits(1);
    }
  };

  const markComplete = async (visitId: string) => {
    setVisits((prev) =>
      prev.map((v) => (v.id === visitId ? { ...v, status: "closed" as const } : v))
    );

    try {
      const res = await fetch(`/api/encounters/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      });
      if (!res.ok) throw new Error("Failed to update");
    } catch {
      fetchVisits(1);
    }
  };

  const hasMore = visits.length < total;

  return { visits, isLoading, hasMore, loadMore, deleteVisit, markComplete };
}
