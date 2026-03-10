"use client";

import { useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import type { Visit, VisitListResponse } from "@/lib/types";

const SIDEBAR_LIMIT = 20;

export function useSidebarVisits() {
  const pathname = usePathname();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchVisits = useCallback(async (pageNum: number) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: pageNum.toString(),
        limit: SIDEBAR_LIMIT.toString(),
      });
      const res = await fetch(`/api/encounters?${params}`);
      if (!res.ok) throw new Error("Failed to fetch visits");

      const data: VisitListResponse = await res.json();

      if (pageNum === 1) {
        setVisits(data.visits);
      } else {
        setVisits((prev) => [...prev, ...data.visits]);
      }
      setTotal(data.total);
    } catch {
      // Silently fail in sidebar — visits are still accessible via search
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Refetch on pathname change (catches new visit creation, navigation)
  useEffect(() => {
    setPage(1);
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

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchVisits(nextPage);
  };

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
