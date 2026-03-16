"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Textarea } from "@/components/shared/textarea";
import { Alert, AlertDescription } from "@/components/shared/alert";
import { Badge } from "@/components/shared/badge";
import { Button } from "@/components/shared/button";
import { Skeleton } from "@/components/shared/skeleton";
import { TextShimmer } from "@/components/shared/text-shimmer";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  type TabOption,
} from "@/components/shared/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/shared/dropdown-menu";
import { HugeiconsIcon } from "@hugeicons/react";
import { AlertCircleIcon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { NoteSectionCard } from "@/components/encounters/note-section-card";
import { TemplateSidebar } from "@/components/encounters/template-sidebar";
import { TiptapEditor } from "@/components/editor/tiptap-editor";
import type { Template } from "@/lib/templates";
import { flattenSectionIds } from "@/lib/templates/html";
import {
  parseSoapSections,
  allSectionsToPlainText,
  type SoapSection,
} from "@/lib/parse-soap-sections";
import { buildTemplateHtml } from "@/lib/templates/html";
import type { Encounter } from "@/lib/types";

interface ReviewViewProps {
  visit: Encounter;
  title: string;
  onTitleChange: (value: string) => void;
  onMetadataBlur: () => void;
  formattedDate: string;
  error: string | null;
  // Generation
  isRegenerating: boolean;
  selectedTemplateId: string;
  onRegenerate: (templateId: string) => void;
  streamedSections: SoapSection[];
  generatedNoteHtml: string;
  // Template
  template: Template | undefined;
  sectionLabels: Record<string, string>;
  // Section editing
  sectionContents: Record<string, string>;
  removedSections: Set<string>;
  onSectionContentChange: (sectionId: string, newContent: string) => void;
  onRemoveSection: (sectionId: string) => void;
  onAddSection: (sectionId: string) => void;
  focusSectionId: string | null;
  onAutoFocused: () => void;
  // Actions
  onMarkComplete: () => void;
  // i18n
  t: (key: string) => string;
  tTemplates: (key: string) => string;
}

export function ReviewView({
  visit,
  title,
  onTitleChange,
  onMetadataBlur,
  formattedDate,
  error,
  isRegenerating,
  selectedTemplateId,
  onRegenerate,
  streamedSections,
  generatedNoteHtml,
  template,
  sectionLabels,
  sectionContents,
  removedSections,
  onSectionContentChange,
  onRemoveSection,
  onAddSection,
  focusSectionId,
  onAutoFocused,
  onMarkComplete,
  t,
  tTemplates,
}: ReviewViewProps) {
  // Tab state
  const [activeTab, setActiveTab] = useState("note");
  const [visibleTabs, setVisibleTabs] = useState<TabOption[]>([]);
  const [noteCopied, setNoteCopied] = useState(false);

  // Sticky header height — drives sidebar sticky offset
  const stickyHeaderRef = useRef<HTMLDivElement>(null);
  const [stickyHeaderHeight, setStickyHeaderHeight] = useState(0);
  useEffect(() => {
    const el = stickyHeaderRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStickyHeaderHeight(el.offsetHeight));
    ro.observe(el);
    setStickyHeaderHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  // Tab configuration
  const allTabs: TabOption[] = useMemo(
    () => [
      { value: "transcript", label: t("detail.transcript") },
      { value: "note", label: t("detail.note") },
      { value: "add-document", label: t("detail.addDocument") },
    ],
    [t],
  );

  const defaultVisibleTabs = useMemo(
    () => allTabs.filter((tab) => tab.value !== "add-document"),
    [allTabs],
  );

  const currentVisibleTabs =
    visibleTabs.length > 0 ? visibleTabs : defaultVisibleTabs;

  const handleAddTab = useCallback(
    (value: string) => {
      const tab = allTabs.find((t) => t.value === value);
      if (tab) {
        setVisibleTabs((prev) => {
          const base = prev.length > 0 ? prev : defaultVisibleTabs;
          return [...base, tab];
        });
        setActiveTab(value);
      }
    },
    [allTabs, defaultVisibleTabs],
  );

  const handleRemoveTab = useCallback(
    (value: string) => {
      setVisibleTabs((prev) => {
        const next = prev.filter((t) => t.value !== value);
        return next.length > 0 ? next : [];
      });
      if (activeTab === value) {
        setActiveTab(defaultVisibleTabs[0]?.value ?? "transcript");
      }
    },
    [activeTab, defaultVisibleTabs],
  );

  // Tabs added via dropdown (not in default set) are removable
  const removableTabValues = useMemo(
    () =>
      currentVisibleTabs
        .filter((t) => !defaultVisibleTabs.some((d) => d.value === t.value))
        .map((t) => t.value),
    [currentVisibleTabs, defaultVisibleTabs],
  );

  /** Determine which section/subsection IDs have content and are not removed */
  const documentedSectionIds = useMemo(() => {
    if (!template) return new Set<string>();
    const documented = new Set<string>();
    for (const id of flattenSectionIds(template)) {
      if (!removedSections.has(id) && sectionContents[id]?.trim()) {
        documented.add(id);
      }
    }
    return documented;
  }, [template, sectionContents, removedSections]);

  // Scroll to a note section card by its template section ID (centered in scroll container)
  const handleScrollToNoteSection = useCallback((sectionId: string) => {
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
  }, []);

  // Switch to note tab before regeneration
  const handleRegenerateWithTabSwitch = useCallback(
    (templateId: string) => {
      setActiveTab("note");
      onRegenerate(templateId);
    },
    [onRegenerate],
  );

  // Copy note to clipboard (excludes empty / "Not stated" sections)
  const handleCopyNote = useCallback(async () => {
    const currentHtml =
      template && Object.keys(sectionContents).length > 0
        ? buildTemplateHtml(
            template,
            Object.fromEntries(
              Object.entries(sectionContents).filter(
                ([id]) => !removedSections.has(id),
              ),
            ),
            sectionLabels,
            { skipEmpty: true },
          )
        : generatedNoteHtml;
    const parsed = parseSoapSections(currentHtml);
    const plainText = allSectionsToPlainText(parsed);
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([currentHtml], { type: "text/html" }),
          "text/plain": new Blob([plainText], { type: "text/plain" }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(plainText);
    }
    setNoteCopied(true);
    setTimeout(() => setNoteCopied(false), 2000);
  }, [
    sectionContents,
    removedSections,
    template,
    sectionLabels,
    generatedNoteHtml,
  ]);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-0">
      {/* Sticky header: title + tab bar */}
      <div
        ref={stickyHeaderRef}
        className="sticky top-0 z-10 flex flex-col gap-5 bg-background pt-6"
      >
        <div className="flex items-center gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Textarea
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              onBlur={onMetadataBlur}
              placeholder={t("untitled")}
              rows={1}
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
              <span className="text-sm text-foreground/65">
                {formattedDate}
              </span>
            </div>
          </div>
          {visit.status === "to_review" && (
            <Button
              variant="outline"
              size="lg"
              className="shrink-0"
              onClick={onMarkComplete}
              disabled={isRegenerating}
            >
              {t("detail.markComplete")}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1 border-b border-border">
          <TabsList variant="line">
            {currentVisibleTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
                {removableTabValues.includes(tab.value) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveTab(tab.value);
                    }}
                    className="ml-1 rounded-sm opacity-50 hover:opacity-100"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
                  </button>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          {allTabs.filter(
            (opt) => !currentVisibleTabs.some((t) => t.value === opt.value),
          ).length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="text-foreground/65 hover:text-foreground"
                >
                  + {t("detail.addDocument")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {allTabs
                  .filter(
                    (opt) =>
                      !currentVisibleTabs.some((t) => t.value === opt.value),
                  )
                  .map((tab) => (
                    <DropdownMenuItem
                      key={tab.value}
                      onClick={() => handleAddTab(tab.value)}
                    >
                      {tab.label}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <Alert variant="destructive">
          <HugeiconsIcon icon={AlertCircleIcon} size={16} />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Tab content — outside sticky area */}
      <TabsContent value="note">
        <div className="flex flex-1 gap-6">
          <div className="pt-6">
            <TemplateSidebar
              templateId={selectedTemplateId}
              onTemplateChange={handleRegenerateWithTabSwitch}
              documentedSections={documentedSectionIds}
              onScrollToSection={handleScrollToNoteSection}
              onAddSection={onAddSection}
              stickyTop={stickyHeaderHeight + 24}
            />
          </div>
          <div className="flex flex-1 flex-col">
            <div
              className="sticky z-10 -mx-1 flex items-center justify-between bg-background px-1 pt-6 pb-4"
              style={{ top: stickyHeaderHeight }}
            >
              <h2 className="text-lg font-medium">{t("detail.note")}</h2>
              {isRegenerating ? (
                <TextShimmer className="text-sm" duration={3}>
                  {t("detail.regenerating")}
                </TextShimmer>
              ) : (
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={handleCopyNote}
                  disabled={!generatedNoteHtml}
                >
                  {noteCopied ? t("detail.noteCopied") : t("detail.copyNote")}
                </Button>
              )}
            </div>
            <div className="flex flex-col gap-4">
              {isRegenerating ? (
                <>
                  {streamedSections.map((section) => (
                    <div
                      key={section.id}
                      className="animate-in fade-in duration-300"
                    >
                      <NoteSectionCard
                        sectionId={section.id}
                        title={section.title}
                        content={section.content}
                      />
                    </div>
                  ))}
                  {streamedSections.length === 0 && (
                    <div className="flex flex-col gap-4">
                      <Skeleton className="h-32 rounded-2xl" />
                      <Skeleton className="h-32 rounded-2xl" />
                      <Skeleton className="h-32 rounded-2xl" />
                    </div>
                  )}
                </>
              ) : template && Object.keys(sectionContents).length > 0 ? (
                template.sections
                  .filter((s) => !removedSections.has(s.id))
                  .map((section) => (
                    <NoteSectionCard
                      key={section.id}
                      id={`note-section-${section.id}`}
                      sectionId={section.id}
                      title={tTemplates(`sections.${section.labelKey}`)}
                      content={sectionContents[section.id] ?? ""}
                      subsections={section.subsections
                        ?.filter((sub) => !removedSections.has(sub.id))
                        .map((sub) => ({
                          id: sub.id,
                          title: tTemplates(`sections.${sub.labelKey}`),
                          content: sectionContents[sub.id] ?? "",
                        }))}
                      onContentChange={onSectionContentChange}
                      onRemove={onRemoveSection}
                      autoFocusId={focusSectionId}
                      onAutoFocused={onAutoFocused}
                    />
                  ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("detail.noNote")}
                </p>
              )}
            </div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="transcript" className="pt-6">
        <div className="rounded-2xl border p-6">
          {visit.raw_text ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {visit.raw_text}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("detail.noTranscript")}
            </p>
          )}
        </div>
      </TabsContent>

      <TabsContent value="add-document">
        <div className="flex-1">
          <TiptapEditor
            content=""
            onChange={() => {}}
            placeholder={t("detail.addDocument")}
            className="flex-1 rounded-2xl"
          />
        </div>
      </TabsContent>
    </Tabs>
  );
}
