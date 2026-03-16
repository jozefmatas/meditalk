"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Encounter } from "@/lib/types";
import type { Template } from "@/lib/templates";
import { parseNoteToSectionMap } from "@/lib/parse-soap-sections";
import { buildTemplateHtml } from "@/lib/templates/html";

interface UseSectionEditingOptions {
  visitId: string;
  template: Template | undefined;
  sectionLabels: Record<string, string>;
  generatedNoteHtml: string;
  setGeneratedNoteHtml: (html: string) => void;
  setVisit: React.Dispatch<React.SetStateAction<Encounter | null>>;
}

export function useSectionEditing({
  visitId,
  template,
  sectionLabels,
  generatedNoteHtml,
  setGeneratedNoteHtml,
  setVisit,
}: UseSectionEditingOptions) {
  // Editable section state (review mode)
  const [sectionContents, setSectionContents] = useState<
    Record<string, string>
  >({});
  const [removedSections, setRemovedSections] = useState<Set<string>>(
    new Set(),
  );
  const [focusSectionId, setFocusSectionId] = useState<string | null>(null);
  const sectionContentsRef = useRef<Record<string, string>>({});

  // Initialize sectionContents from generated HTML — setState is intentional here
  // because we're syncing local editing state from externally-generated HTML.
  useEffect(() => {
    if (!template || !generatedNoteHtml) return;
    const map = parseNoteToSectionMap(generatedNoteHtml, template);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from external data
    setSectionContents(map);
    sectionContentsRef.current = map;

    // Auto-hide sections/subsections whose content was "Not stated" (now empty)
    const removed = new Set<string>();
    for (const section of template.sections) {
      const hasContent = !!map[section.id]?.trim();
      const hasSubContent = section.subsections?.some(
        (sub) => !!map[sub.id]?.trim(),
      );

      if (!hasContent && !hasSubContent) {
        // Entire section empty — hide card and all subsections
        removed.add(section.id);
        section.subsections?.forEach((sub) => removed.add(sub.id));
      } else {
        // Some content exists — only hide individual empty subsections
        section.subsections?.forEach((sub) => {
          if (!map[sub.id]?.trim()) removed.add(sub.id);
        });
      }
    }
    setRemovedSections(removed);
  }, [generatedNoteHtml, template]);

  // Rebuild HTML from current section state and save to DB
  const saveNoteRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saveNote = useCallback(
    (contents: Record<string, string>, removed: Set<string>) => {
      if (!template || !visitId) return;
      clearTimeout(saveNoteRef.current);
      saveNoteRef.current = setTimeout(async () => {
        // Filter out removed sections
        const filtered: Record<string, string> = {};
        for (const [id, text] of Object.entries(contents)) {
          if (!removed.has(id)) filtered[id] = text;
        }
        const html = buildTemplateHtml(template, filtered, sectionLabels);
        try {
          await fetch(`/api/encounters/${visitId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ soap_note: html }),
          });
          // Update local state so copy works with latest
          setGeneratedNoteHtml(html);
          setVisit((prev) => (prev ? { ...prev, soap_note: html } : prev));
        } catch {
          // Silent fail
        }
      }, 2000);
    },
    [template, visitId, sectionLabels, setGeneratedNoteHtml, setVisit],
  );

  // Handle section content edit
  const handleSectionContentChange = useCallback(
    (sectionId: string, newContent: string) => {
      setSectionContents((prev) => {
        const next = { ...prev, [sectionId]: newContent };
        sectionContentsRef.current = next;
        saveNote(next, removedSections);
        return next;
      });
    },
    [saveNote, removedSections],
  );

  // Handle section removal
  const handleRemoveSection = useCallback(
    (sectionId: string) => {
      setRemovedSections((prev) => {
        const next = new Set(prev);
        next.add(sectionId);
        saveNote(sectionContentsRef.current, next);
        return next;
      });
    },
    [saveNote],
  );

  // Handle re-adding a removed section from sidebar
  const handleAddSection = useCallback(
    (sectionId: string) => {
      setRemovedSections((prev) => {
        const next = new Set(prev);
        next.delete(sectionId);
        saveNote(sectionContentsRef.current, next);
        return next;
      });
      // Ensure an empty content entry exists so the card renders with placeholder
      setSectionContents((prev) => {
        if (sectionId in prev) return prev;
        const next = { ...prev, [sectionId]: "" };
        sectionContentsRef.current = next;
        return next;
      });
      // Auto-focus the editor and scroll to center within the scroll container
      setFocusSectionId(sectionId);
      requestAnimationFrame(() => {
        const el = document.getElementById(`note-section-${sectionId}`);
        if (!el) return;

        // Find the nearest scrollable ancestor (overflow-y: auto/scroll)
        let scrollContainer = el.parentElement;
        while (scrollContainer) {
          const { overflowY } = getComputedStyle(scrollContainer);
          if (overflowY === "auto" || overflowY === "scroll") break;
          scrollContainer = scrollContainer.parentElement;
        }
        if (!scrollContainer) return;

        const containerRect = scrollContainer.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const scrollTarget =
          scrollContainer.scrollTop +
          (elRect.top - containerRect.top) -
          containerRect.height / 2 +
          elRect.height / 2;

        scrollContainer.scrollTo({
          top: Math.max(0, scrollTarget),
          behavior: "smooth",
        });
      });
    },
    [saveNote],
  );

  const handleAutoFocused = useCallback(() => setFocusSectionId(null), []);

  return {
    sectionContents,
    removedSections,
    focusSectionId,
    sectionContentsRef,
    handleSectionContentChange,
    handleRemoveSection,
    handleAddSection,
    handleAutoFocused,
  };
}
