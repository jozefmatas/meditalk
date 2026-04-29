"use client";

import { useMemo, useCallback } from "react";
import { Skeleton } from "@/components/shared/skeleton";
import { NoteSectionCard } from "@/components/encounters/note-section-card";
import { NOT_STATED_VALUES, type NoteSection } from "@/lib/parse-note-sections";
import type { Template } from "@/lib/templates";

interface NoteSectionsListProps {
  template: Template | undefined;
  isRegenerating: boolean;
  isStreamingGeneration: boolean;
  streamedSections: NoteSection[];
  streamingSectionLabels?: Record<string, string>;
  sectionContents: Record<string, string>;
  removedSections: Set<string>;
  sectionLabels: Record<string, string>;
  onSectionContentChange: (id: string, content: string) => void;
  onRemoveSection: (id: string) => void;
  focusSectionId: string | null;
  onAutoFocused: () => void;
  noNoteLabel: string;
  /** Feedback rating lookup (null = no rating yet) */
  getFeedbackRating?: (sectionId: string) => "up" | "down" | null;
  /** Thumbs-up handler per section */
  onSectionThumbsUp?: (sectionId: string) => void;
  /** Thumbs-down handler per section */
  onSectionThumbsDown?: (sectionId: string) => void;
}

/**
 * Renders the note section cards — handles three states:
 * 1. Streaming: template hierarchy with skeleton placeholders + fade-in
 * 2. Final: editable NoteSectionCard list with section filtering
 * 3. Empty: "No note" fallback text
 */
export function NoteSectionsList({
  template,
  isRegenerating,
  isStreamingGeneration,
  streamedSections,
  streamingSectionLabels,
  sectionContents,
  removedSections,
  sectionLabels,
  onSectionContentChange,
  onRemoveSection,
  focusSectionId,
  onAutoFocused,
  noNoteLabel,
  getFeedbackRating,
  onSectionThumbsUp,
  onSectionThumbsDown,
}: NoteSectionsListProps) {
  const isActivelyStreaming = isRegenerating || isStreamingGeneration;

  // Map of streamed section content for quick lookup
  const streamedMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of streamedSections) map.set(s.id, s.content);
    return map;
  }, [streamedSections]);

  /** Check if a streamed value has meaningful content (not empty / not a NOT_STATED placeholder). */
  const hasMeaningfulContent = useCallback((value: string | undefined) => {
    if (value === undefined) return false;
    const trimmed = value.trim();
    return trimmed.length > 0 && !NOT_STATED_VALUES.has(trimmed);
  }, []);

  // Streaming mode with template hierarchy
  if (isActivelyStreaming && template) {
    return (
      <>
        {template.sections.map((section) => {
          const mainContent = streamedMap.get(section.id);
          const isMainReceived = streamedMap.has(section.id);
          const hasMainContent = hasMeaningfulContent(mainContent);
          const label =
            streamingSectionLabels?.[section.id] ??
            sectionLabels[section.id] ??
            section.id;

          // Build subsection data with streamed or pending content
          const subsectionData = section.subsections?.map((sub) => {
            const subContent = streamedMap.get(sub.id);
            const subLabel =
              streamingSectionLabels?.[sub.id] ??
              sectionLabels[sub.id] ??
              sub.id;
            return {
              id: sub.id,
              title: subLabel,
              content: subContent,
              received: streamedMap.has(sub.id),
            };
          });

          const hasAnyContent =
            hasMainContent ||
            subsectionData?.some((s) => hasMeaningfulContent(s.content));

          // All parts received (main + subsections)?
          const allReceived =
            isMainReceived &&
            (!subsectionData || subsectionData.every((s) => s.received));

          if (hasAnyContent) {
            // Show card — filter out received-but-empty subsections
            return (
              <div key={section.id} className="animate-in fade-in duration-300">
                <NoteSectionCard
                  sectionId={section.id}
                  title={label}
                  content={hasMainContent ? mainContent! : ""}
                  subsections={subsectionData
                    ?.filter((s) => hasMeaningfulContent(s.content))
                    .map((s) => ({
                      id: s.id,
                      title: s.title,
                      content: s.content ?? "",
                    }))}
                />
              </div>
            );
          }

          // All received but all empty — hide entirely (no flash)
          if (allReceived) return null;

          // Still pending — show skeleton
          return (
            <div
              key={section.id}
              className="rounded-2xl border border-border p-6"
            >
              <div className="flex flex-col gap-3">
                <Skeleton className="h-5 w-32 rounded" />
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-full rounded" />
                  <Skeleton className="h-4 w-4/5 rounded" />
                  <Skeleton className="h-4 w-3/5 rounded" />
                </div>
                {subsectionData &&
                  subsectionData.length > 0 &&
                  subsectionData.map((sub) => (
                    <div key={sub.id} className="mt-2 flex flex-col gap-2">
                      <Skeleton className="h-4 w-24 rounded" />
                      <Skeleton className="h-4 w-full rounded" />
                      <Skeleton className="h-4 w-3/4 rounded" />
                    </div>
                  ))}
              </div>
            </div>
          );
        })}
      </>
    );
  }

  // Streaming mode without template — generic skeletons
  if (isActivelyStreaming) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    );
  }

  // Final mode — editable section cards
  if (template && Object.keys(sectionContents).length > 0) {
    return (
      <>
        {template.sections
          .filter((s) => !removedSections.has(s.id))
          .map((section) => (
            <NoteSectionCard
              key={section.id}
              id={`note-section-${section.id}`}
              sectionId={section.id}
              title={sectionLabels[section.id] ?? section.id}
              content={sectionContents[section.id] ?? ""}
              subsections={section.subsections
                ?.filter((sub) => !removedSections.has(sub.id))
                .map((sub) => ({
                  id: sub.id,
                  title: sectionLabels[sub.id] ?? sub.id,
                  content: sectionContents[sub.id] ?? "",
                }))}
              onContentChange={onSectionContentChange}
              onRemove={onRemoveSection}
              autoFocusId={focusSectionId}
              onAutoFocused={onAutoFocused}
              feedbackRating={getFeedbackRating?.(section.id) ?? null}
              onThumbsUp={
                onSectionThumbsUp
                  ? () => onSectionThumbsUp(section.id)
                  : undefined
              }
              onThumbsDown={
                onSectionThumbsDown
                  ? () => onSectionThumbsDown(section.id)
                  : undefined
              }
            />
          ))}
      </>
    );
  }

  // No note fallback
  return <p className="text-sm text-muted-foreground">{noNoteLabel}</p>;
}
