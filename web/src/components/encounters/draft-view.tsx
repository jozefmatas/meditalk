"use client";

import { useRef, useCallback, useMemo } from "react";
import { Textarea } from "@/components/shared/textarea";
import { Badge } from "@/components/shared/badge";
import { ErrorAlert } from "@/components/shared/error-alert";
import {
  RecordingBar,
  type RecordingBarRef,
} from "@/components/encounters/recording-bar";
import { TemplateSidebar } from "@/components/encounters/template-sidebar";
import {
  TiptapEditor,
  type Editor,
  type SlashCommandItem,
} from "@/components/editor/tiptap-editor";
import { flattenTemplateSections, type Template } from "@/lib/templates";
import type { Encounter } from "@/lib/types";

interface DraftViewProps {
  visit: Encounter;
  title: string;
  onTitleChange: (value: string) => void;
  onMetadataBlur: () => void;
  formattedDate: string;
  error: string | null;
  // Recording
  recordingBarRef: React.RefObject<RecordingBarRef | null>;
  isGenerating: boolean;
  onRecordingComplete: (blob: Blob) => void;
  onRecordingStateChange: (state: "idle" | "recording" | "paused") => void;
  // Template
  selectedTemplateId: string;
  onTemplateChange: (id: string) => void;
  template: Template | undefined;
  // Editor
  doctorNotes: string;
  onDoctorNotesChange: (value: string) => void;
  // i18n
  t: (key: string) => string;
  tTemplates: (key: string) => string;
}

export function DraftView({
  visit,
  title,
  onTitleChange,
  onMetadataBlur,
  formattedDate,
  error,
  recordingBarRef,
  isGenerating,
  onRecordingComplete,
  onRecordingStateChange,
  selectedTemplateId,
  onTemplateChange,
  template,
  doctorNotes,
  onDoctorNotesChange,
  t,
  tTemplates,
}: DraftViewProps) {
  // TipTap editor ref
  const editorRef = useRef<Editor | null>(null);
  const handleEditorReady = useCallback((editor: Editor) => {
    editorRef.current = editor;
  }, []);

  // Flatten template sections for # slash command and sidebar
  const flatSections = useMemo(
    () => (template ? flattenTemplateSections(template) : []),
    [template],
  );

  // Detect which section headings already exist in the editor content
  const usedSectionIds = useMemo(() => {
    if (!doctorNotes || flatSections.length === 0) return new Set<string>();
    const used = new Set<string>();
    const parser = new DOMParser();
    const doc = parser.parseFromString(doctorNotes, "text/html");
    const headings = doc.querySelectorAll("h2, h3");
    headings.forEach((h) => {
      const text = h.textContent?.trim();
      if (!text) return;
      const match = flatSections.find(
        (s) => tTemplates(`sections.${s.labelKey}`) === text,
      );
      if (match) used.add(match.id);
    });
    return used;
  }, [doctorNotes, flatSections, tTemplates]);

  // Build slash command items (only unused sections)
  const slashCommandItems: SlashCommandItem[] = useMemo(() => {
    return flatSections
      .filter((s) => !usedSectionIds.has(s.id))
      .map((s) => ({
        id: s.id,
        label: tTemplates(`sections.${s.labelKey}`),
        level: s.level,
        parentLabel: s.parentId
          ? tTemplates(
              `sections.${flatSections.find((p) => p.id === s.parentId)?.labelKey ?? s.labelKey}`,
            )
          : undefined,
        needsParentHeading: s.parentId
          ? !usedSectionIds.has(s.parentId)
          : false,
      }));
  }, [flatSections, usedSectionIds, tTemplates]);

  // Insert a heading into the editor at cursor position
  const handleInsertSection = useCallback(
    (sectionId: string, label: string, level: 2 | 3) => {
      const editor = editorRef.current;
      if (!editor) return;

      const content: Record<string, unknown>[] = [];

      // Auto-insert parent heading when adding a subsection whose parent isn't in the editor yet
      if (level === 3) {
        const section = flatSections.find((s) => s.id === sectionId);
        if (section?.parentId && !usedSectionIds.has(section.parentId)) {
          const parent = flatSections.find((s) => s.id === section.parentId);
          if (parent) {
            content.push({
              type: "heading",
              attrs: { level: 2 },
              content: [
                {
                  type: "text",
                  text: tTemplates(`sections.${parent.labelKey}`),
                },
              ],
            });
          }
        }
      }

      content.push(
        {
          type: "heading",
          attrs: { level },
          content: [{ type: "text", text: label }],
        },
        { type: "paragraph" },
      );

      editor.chain().focus().insertContent(content).run();
    },
    [flatSections, usedSectionIds, tTemplates],
  );

  // Scroll to an existing heading in the editor and place cursor at its end
  const handleScrollToSection = useCallback((label: string) => {
    const editor = editorRef.current;
    if (!editor) return;

    const { doc } = editor.state;
    let headingNodePos: number | null = null;
    let cursorPos: number | null = null;

    doc.descendants((node, pos) => {
      if (headingNodePos !== null) return false;
      if (node.type.name === "heading" && node.textContent.trim() === label) {
        headingNodePos = pos;
        cursorPos = pos + node.nodeSize - 1;
        return false;
      }
    });

    if (headingNodePos === null || cursorPos === null) return;

    // Get the heading DOM element directly from ProseMirror
    const headingDom = editor.view.nodeDOM(
      headingNodePos,
    ) as HTMLElement | null;
    if (!headingDom) return;

    // Walk up from the editor DOM to find the scrollable ancestor
    let scrollContainer: HTMLElement | null = editor.view.dom.parentElement;
    while (scrollContainer) {
      const { overflowY } = getComputedStyle(scrollContainer);
      if (overflowY === "auto" || overflowY === "scroll") break;
      scrollContainer = scrollContainer.parentElement;
    }

    if (scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const headingRect = headingDom.getBoundingClientRect();
      const scrollTarget =
        scrollContainer.scrollTop +
        (headingRect.top - containerRect.top) -
        containerRect.height / 2 +
        headingRect.height / 2;

      scrollContainer.scrollTo({ top: scrollTarget, behavior: "smooth" });
    }

    // Focus and place cursor at end of heading after the scroll animation
    const finalPos = cursorPos;
    setTimeout(() => {
      editor.chain().focus().setTextSelection(finalPos).run();
    }, 300);
  }, []);

  return (
    <>
      {/* Sticky header: title + recording bar */}
      <div className="shrink-0 flex flex-col gap-5 border-b border-border bg-background py-6">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Textarea
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            onBlur={onMetadataBlur}
            placeholder={t("untitled")}
            rows={1}
            autoFocus
            className="min-h-0 h-auto resize-none overflow-hidden rounded-none border-none bg-transparent px-0 py-0.5 text-2xl md:text-2xl shadow-none placeholder:text-foreground/65 focus-visible:ring-0"
            onInput={(e) => {
              const target = e.currentTarget;
              target.style.height = "auto";
              target.style.height = `${target.scrollHeight}px`;
            }}
            ref={(el) => {
              if (el) {
                el.style.height = "auto";
                el.style.height = `${el.scrollHeight}px`;
              }
            }}
          />
          <div className="flex items-center gap-3">
            <Badge variant={`status-${visit.status}` as "status-started"}>
              {t(`status.${visit.status}`)}
            </Badge>
            <span className="text-sm text-foreground/65">{formattedDate}</span>
          </div>
        </div>
        <RecordingBar
          ref={recordingBarRef}
          disabled={isGenerating}
          onRecordingComplete={onRecordingComplete}
          onRecordingStateChange={onRecordingStateChange}
          templateId={selectedTemplateId}
          onTemplateChange={onTemplateChange}
        />
      </div>

      {/* Error alert */}
      {error && (
        <ErrorAlert
          message={
            error === "insufficient_context" ? t("insufficientContext") : error
          }
        />
      )}

      {/* Draft: template sidebar + editor */}
      <div className="flex flex-1 min-h-0 gap-6">
        <TemplateSidebar
          templateId={selectedTemplateId}
          onTemplateChange={onTemplateChange}
          disabled={isGenerating}
          onInsertSection={handleInsertSection}
          usedSectionIds={usedSectionIds}
          onScrollToSection={handleScrollToSection}
        />
        <TiptapEditor
          content={doctorNotes}
          onChange={onDoctorNotesChange}
          placeholder={tTemplates("doctorNotesPlaceholder")}
          className="flex-1 overflow-y-auto rounded-2xl"
          onEditorReady={handleEditorReady}
          slashCommandItems={slashCommandItems}
        />
      </div>
    </>
  );
}
