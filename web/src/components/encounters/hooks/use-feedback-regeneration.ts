"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { Template, TemplateSection } from "@/lib/templates/types";

interface UseFeedbackRegenerationProps {
  visitId: string | undefined;
  sectionContentsRef: React.RefObject<Record<string, string>>;
  replaceSections: (updates: Record<string, string>) => void;
  template: Template | null | undefined;
  sectionLabels: Record<string, string>;
}

/**
 * Recursively find a section in the template by ID
 */
function findSectionInTemplate(
  sections: TemplateSection[],
  targetId: string,
): TemplateSection | null {
  for (const section of sections) {
    if (section.id === targetId) {
      return section;
    }
    if (section.subsections) {
      const found = findSectionInTemplate(section.subsections, targetId);
      if (found) return found;
    }
  }
  return null;
}

export function useFeedbackRegeneration({
  visitId,
  sectionContentsRef,
  replaceSections,
  template,
  sectionLabels,
}: UseFeedbackRegenerationProps) {
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

        // 2. Trigger section regeneration
        setRegeneratingSectionId(sectionId);

        const currentContent = sectionContentsRef.current?.[sectionId] || "";

        // Build context from other sections so the LLM can reference
        // lab results, findings, etc. when adjusting this section
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

          // 3. Update subsection content in UI
          replaceSections(updates);
        } else {
          // Leaf section with content - regenerate single section
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

          // 3. Update section content in UI
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
    handleSectionSubmitFeedback,
    regeneratingSectionId,
  };
}
