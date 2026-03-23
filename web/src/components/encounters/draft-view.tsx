"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Textarea } from "@/components/shared/textarea";
import { Badge } from "@/components/shared/badge";
import { ErrorAlert } from "@/components/shared/error-alert";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/shared/tabs";
import {
  RecordingBar,
  type RecordingBarRef,
} from "@/components/encounters/recording-bar";
import { TemplateSidebar } from "@/components/encounters/template-sidebar";
import {
  FilesContent,
  type EncounterFile,
} from "@/components/encounters/files-panel";
import {
  TiptapEditor,
  type Editor,
  type SlashCommandItem,
} from "@/components/editor/tiptap-editor";
import {
  flattenTemplateSections,
  resolveSectionLabel,
  type Template,
} from "@/lib/templates";
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
  onRecordingComplete: (blob: Blob) => void;
  onRecordingStateChange: (state: "idle" | "recording" | "paused") => void;
  // Template
  selectedTemplateId: string;
  onTemplateChange: (id: string) => void;
  template: Template | undefined;
  // Editor
  doctorNotes: string;
  onDoctorNotesChange: (value: string) => void;
  // Files (for mobile tab)
  visitId: string;
  files: EncounterFile[];
  onFilesChange: (files: EncounterFile[]) => void;
  // Retry
  onRetry?: () => void;
  // i18n
  t: (key: string) => string;
}

export function DraftView({
  visit,
  title,
  onTitleChange,
  onMetadataBlur,
  formattedDate,
  error,
  recordingBarRef,
  onRecordingComplete,
  onRecordingStateChange,
  selectedTemplateId,
  onTemplateChange,
  template,
  doctorNotes,
  onDoctorNotesChange,
  visitId,
  files,
  onFilesChange,
  onRetry,
  t,
}: DraftViewProps) {
  const tTemplates = useTranslations("templates");
  const locale = useLocale();

  // Mobile tab state
  const [mobileTab, setMobileTab] = useState<"files" | "notes">("files");

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
        (s) => resolveSectionLabel(s, locale) === text,
      );
      if (match) used.add(match.id);
    });
    return used;
  }, [doctorNotes, flatSections, locale]);

  // Build slash command items (only unused sections)
  const slashCommandItems: SlashCommandItem[] = useMemo(() => {
    return flatSections
      .filter((s) => !usedSectionIds.has(s.id))
      .map((s) => ({
        id: s.id,
        label: resolveSectionLabel(s, locale),
        level: s.level,
        parentLabel: s.parentId
          ? resolveSectionLabel(
              flatSections.find((p) => p.id === s.parentId) ?? s,
              locale,
            )
          : undefined,
        needsParentHeading: s.parentId
          ? !usedSectionIds.has(s.parentId)
          : false,
      }));
  }, [flatSections, usedSectionIds, locale]);

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
                  text: resolveSectionLabel(parent, locale),
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
    [flatSections, usedSectionIds, locale],
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
      <div className="shrink-0 flex flex-col gap-5 border-border bg-background pt-4 desktop:border-b desktop:py-6">
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
            <span className="text-sm text-foreground/65">{formattedDate}</span>
            <Badge variant={`status-${visit.status}` as "status-started"}>
              {t(`status.${visit.status}`)}
            </Badge>
          </div>
        </div>
        <RecordingBar
          ref={recordingBarRef}
          onRecordingComplete={onRecordingComplete}
          onRecordingStateChange={onRecordingStateChange}
          templateId={selectedTemplateId}
          onTemplateChange={onTemplateChange}
        />
      </div>

      {/* Error alert */}
      {error && (
        <ErrorAlert
          message={t(
            error === "insufficient_context"
              ? "insufficientContext"
              : error === "generation_interrupted"
                ? "generationInterrupted"
                : error === "network_error"
                  ? "networkError"
                  : error === "save_failed"
                    ? "saveFailed"
                    : "generationFailed",
          )}
          onRetry={error !== "insufficient_context" ? onRetry : undefined}
          retryLabel={t("detail.retry")}
        />
      )}

      {/* Mobile: Files / Notes tabs */}
      <div className="flex flex-1 min-h-0 flex-col desktop:hidden">
        <Tabs
          value={mobileTab}
          onValueChange={(v) => setMobileTab(v as "files" | "notes")}
          className="flex flex-1 min-h-0 flex-col"
        >
          <div className="shrink-0 border-b border-border">
            <TabsList variant="line">
              <TabsTrigger value="files">{t("detail.filesTab")}</TabsTrigger>
              <TabsTrigger value="notes">{t("detail.notesTab")}</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent
            value="files"
            className="flex-1 min-h-0 overflow-y-auto pt-4"
          >
            <div className="flex flex-col gap-4">
              <FilesContent
                visitId={visitId}
                files={files}
                onFilesChange={onFilesChange}
              />
              <div aria-hidden className="min-h-40 shrink-0" />
            </div>
          </TabsContent>

          <TabsContent
            value="notes"
            className="flex flex-1 min-h-0 flex-col overflow-y-auto pt-4"
          >
            <TiptapEditor
              content={doctorNotes}
              onChange={onDoctorNotesChange}
              placeholder={tTemplates("doctorNotesPlaceholder")}
              className="flex-1 rounded-2xl"
              onEditorReady={handleEditorReady}
              slashCommandItems={slashCommandItems}
            />
            <div aria-hidden className="min-h-40 shrink-0" />
          </TabsContent>
        </Tabs>
      </div>

      {/* Desktop: template sidebar + editor */}
      <div className="hidden desktop:flex flex-1 min-h-0 gap-6">
        <TemplateSidebar
          templateId={selectedTemplateId}
          template={template}
          onTemplateChange={onTemplateChange}
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
