"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { Template, TemplateSection } from "@/lib/templates/types";

// ── Types ─────────────────────────────────────────────────────────

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

interface UseSectionFeedbackParams {
  visitId: string | undefined;
  sectionContentsRef: React.RefObject<Record<string, string>>;
  replaceSections: (updates: Record<string, string>) => void;
  template: Template | null | undefined;
  sectionLabels: Record<string, string>;
}

// ── Helpers ───────────────────────────────────────────────────────

/** Recursively find a section in the template by ID. */
function findSectionInTemplate(
  sections: TemplateSection[],
  targetId: string,
): TemplateSection | null {
  for (const section of sections) {
    if (section.id === targetId) return section;
    if (section.subsections) {
      const found = findSectionInTemplate(section.subsections, targetId);
      if (found) return found;
    }
  }
  return null;
}

// ── Hook ──────────────────────────────────────────────────────────

export function useSectionFeedback({
  visitId,
  sectionContentsRef,
  replaceSections,
  template,
  sectionLabels,
}: UseSectionFeedbackParams) {
  const tFeedback = useTranslations("encounters.detail.feedback");

  // ── Rating state ────────────────────────────────────────────────

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

  // ── Regeneration state ──────────────────────────────────────────

  const [regeneratingSectionId, setRegeneratingSectionId] = useState<
    string | null
  >(null);

  const handleSectionSubmitFeedback = useCallback(
    async (sectionId: string, detail: string, remember: boolean) => {
      if (!visitId) return;

      try {
        // 1. Submit feedback to save to DB
        const feedbackResponse = await fetch(
          `/api/encounters/${visitId}/feedback`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sectionId,
              rating: "down",
              categories: [],
              detail,
              remember,
            }),
          },
        );

        if (!feedbackResponse.ok) {
          throw new Error("Failed to submit feedback");
        }

        // Update local rating state to match
        setRatings((r) => new Map(r).set(sectionId, "down"));

        // 2. Trigger section regeneration
        setRegeneratingSectionId(sectionId);

        const currentContent = sectionContentsRef.current?.[sectionId] || "";

        // Build context from other sections
        const otherSectionContents: Record<string, string> = {};
        if (sectionContentsRef.current) {
          for (const [id, content] of Object.entries(
            sectionContentsRef.current,
          )) {
            if (id !== sectionId && content?.trim()) {
              otherSectionContents[id] = content;
            }
          }
        }

        // Check if this is a parent section (no content)
        const isParentSection =
          !currentContent || currentContent.trim().length === 0;

        if (isParentSection) {
          // Find child sections from template structure
          const childSections: Record<string, string> = {};

          if (template) {
            const section = findSectionInTemplate(template.sections, sectionId);
            if (section?.subsections) {
              for (const subsection of section.subsections) {
                const content =
                  sectionContentsRef.current?.[subsection.id] || "";
                childSections[subsection.id] = content;
              }
            }
          }

          // Build subsection labels for API
          const subsectionLabels: Record<string, string> = {};
          for (const id of Object.keys(childSections)) {
            subsectionLabels[id] = sectionLabels[id] || id;
          }

          // Send parent section feedback with all child sections
          const regenResponse = await fetch("/api/adjust-section", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              visitId,
              sectionId,
              feedbackText: detail,
              subsections: childSections,
              subsectionLabels,
              otherSectionContents,
              sectionLabels,
            }),
          });

          if (!regenResponse.ok) {
            throw new Error("Failed to regenerate parent section");
          }

          const { updates } = await regenResponse.json();
          replaceSections(updates);
        } else {
          // Leaf section with content — regenerate single section
          const regenResponse = await fetch("/api/adjust-section", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              visitId,
              sectionId,
              currentContent,
              feedbackText: detail,
              otherSectionContents,
              sectionLabels,
            }),
          });

          if (!regenResponse.ok) {
            throw new Error("Failed to regenerate section");
          }

          const { sectionId: updatedSectionId, content } =
            await regenResponse.json();
          replaceSections({ [updatedSectionId]: content });
        }
      } catch {
        toast.error("Failed to regenerate section");
      } finally {
        setRegeneratingSectionId(null);
      }
    },
    [visitId, sectionContentsRef, replaceSections, template, sectionLabels],
  );

  return {
    getRating,
    submitUp,
    submitDown,
    removeFeedback,
    handleSectionSubmitFeedback,
    regeneratingSectionId,
    isLoaded,
  };
}
