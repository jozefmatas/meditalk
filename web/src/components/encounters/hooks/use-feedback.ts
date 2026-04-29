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
  categories: string[];
  detail: string;
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

      setRatings((prev) => new Map(prev).set(sectionId, "up"));

      await fetch(`/api/encounters/${visitId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId: sectionId ?? undefined,
          rating: "up",
        }),
      });

      toast.success(tFeedback("toastTitle"), {
        description: tFeedback("toastDescription"),
      });
    },
    [visitId, tFeedback],
  );

  const submitDown = useCallback(
    async (sectionId: string | null, options: SubmitDownOptions) => {
      if (!visitId) return;

      setRatings((prev) => new Map(prev).set(sectionId, "down"));

      await fetch(`/api/encounters/${visitId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId: sectionId ?? undefined,
          sectionKind: options.sectionKind,
          rating: "down",
          categories: options.categories,
          detail: options.detail,
        }),
      });

      toast.success(tFeedback("toastTitle"), {
        description: tFeedback("toastDescription"),
      });
    },
    [visitId, tFeedback],
  );

  return { getRating, submitUp, submitDown, isLoaded };
}
