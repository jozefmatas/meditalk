"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

interface FeedbackEntry {
  id: string;
  section_id: string | null;
  rating: "up" | "down";
  categories: string[];
  detail: string;
}

interface SubmitDownOptions {
  sectionKind?: string;
  categories?: string[];
  detail: string;
  remember?: boolean;
}

export function useFeedback(visitId: string | undefined) {
  const tFeedback = useTranslations("encounters.detail.feedback");
  const [ratings, setRatings] = useState<Map<string | null, "up" | "down">>(
    new Map(),
  );
  const [isLoaded, setIsLoaded] = useState(false);
  const fetchedRef = useRef(false);

  // Load existing feedback on mount
  useEffect(() => {
    if (!visitId || fetchedRef.current) return;
    fetchedRef.current = true;

    fetch(`/api/encounters/${visitId}/feedback`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.feedback) return;
        const map = new Map<string | null, "up" | "down">();
        for (const entry of data.feedback as FeedbackEntry[]) {
          map.set(entry.section_id, entry.rating);
        }
        setRatings(map);
      })
      .finally(() => setIsLoaded(true));
  }, [visitId]);

  const getRating = useCallback(
    (sectionId: string | null): "up" | "down" | null => {
      return ratings.get(sectionId) ?? null;
    },
    [ratings],
  );

  const submitUp = useCallback(
    async (sectionId: string | null) => {
      if (!visitId) return;

      const prev = ratings.get(sectionId) ?? null;
      setRatings((r) => new Map(r).set(sectionId, "up"));

      try {
        const res = await fetch(`/api/encounters/${visitId}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sectionId: sectionId ?? undefined,
            rating: "up",
          }),
        });
        if (!res.ok) throw new Error("Request failed");
        toast.success(tFeedback("toastMessage"));
      } catch {
        setRatings((r) => {
          const next = new Map(r);
          if (prev) next.set(sectionId, prev);
          else next.delete(sectionId);
          return next;
        });
        toast.error("Failed to save feedback");
      }
    },
    [visitId, tFeedback, ratings],
  );

  const submitDown = useCallback(
    async (sectionId: string | null, options: SubmitDownOptions) => {
      if (!visitId) return;

      const prev = ratings.get(sectionId) ?? null;
      setRatings((r) => new Map(r).set(sectionId, "down"));

      try {
        const res = await fetch(`/api/encounters/${visitId}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sectionId: sectionId ?? undefined,
            sectionKind: options.sectionKind,
            rating: "down",
            categories: options.categories ?? [],
            detail: options.detail,
            remember: options.remember ?? false,
          }),
        });
        if (!res.ok) throw new Error("Request failed");
        toast.success(tFeedback("toastMessage"));
      } catch {
        setRatings((r) => {
          const next = new Map(r);
          if (prev) next.set(sectionId, prev);
          else next.delete(sectionId);
          return next;
        });
        toast.error("Failed to save feedback");
      }
    },
    [visitId, tFeedback, ratings],
  );

  const clearRating = useCallback((sectionId: string | null) => {
    setRatings((prev) => {
      const next = new Map(prev);
      next.delete(sectionId);
      return next;
    });
  }, []);

  const removeFeedback = useCallback(
    async (sectionId: string | null) => {
      if (!visitId) return;

      const prev = ratings.get(sectionId) ?? null;
      clearRating(sectionId);

      try {
        const res = await fetch(`/api/encounters/${visitId}/feedback`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sectionId: sectionId ?? undefined,
          }),
        });
        if (!res.ok) throw new Error("Request failed");
      } catch {
        // Rollback
        if (prev) setRatings((r) => new Map(r).set(sectionId, prev));
        toast.error("Failed to remove feedback");
      }
    },
    [visitId, clearRating, ratings],
  );

  return {
    getRating,
    submitUp,
    submitDown,
    removeFeedback,
    isLoaded,
  };
}
