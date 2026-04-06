"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Textarea } from "@/components/shared/textarea";
import { Badge } from "@/components/shared/badge";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Button } from "@/components/shared/button";
import { TextShimmer } from "@/components/shared/text-shimmer";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  type TabOption,
} from "@/components/shared/tabs";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  Mail01Icon,
  Tick02Icon,
  Loading03Icon,
  AlertCircleIcon,
} from "@hugeicons/core-free-icons";
import { AdjustDrawer } from "@/components/encounters/adjust-drawer";
import { TemplateSidebar } from "@/components/encounters/template-sidebar";
import { TemplateSelector } from "@/components/templates/template-selector";
import { IcdPanelContent } from "@/components/encounters/icd-panel";
import { NoteSectionsList } from "@/components/encounters/note-sections-list";
import { ResourcesPanel } from "@/components/encounters/resources-panel";
import { useMobileHeaderCollapse } from "@/components/encounters/hooks/use-mobile-header-collapse";
import { useNoteActions } from "@/components/encounters/hooks/use-note-actions";
import type { Template } from "@/lib/templates";
import { flattenSectionIds } from "@/lib/templates/html";
import { NOT_STATED_VALUES, type NoteSection } from "@/lib/parse-note-sections";
import type { Encounter } from "@/lib/types";

interface ReviewViewProps {
  visit: Encounter;
  setVisit: React.Dispatch<React.SetStateAction<Encounter | null>>;
  title: string;
  onTitleChange: (value: string) => void;
  onMetadataBlur: () => void;
  formattedDate: string;
  error: string | null;
  // Generation
  isRegenerating: boolean;
  /** True when initial generation is streaming (shows skeleton sections) */
  isStreamingGeneration?: boolean;
  selectedTemplateId: string;
  onRegenerate: (templateId: string) => void;
  streamedSections: NoteSection[];
  /** Section labels from streaming_start event */
  streamingSectionLabels?: Record<string, string>;
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
  // Retry
  onRetry?: () => void;
  // Adjust
  visitId?: string;
  files?: import("@/components/encounters/files-panel").EncounterFile[];
  onFilesChange?: (
    files:
      | import("@/components/encounters/files-panel").EncounterFile[]
      | ((
          prev: import("@/components/encounters/files-panel").EncounterFile[],
        ) => import("@/components/encounters/files-panel").EncounterFile[]),
  ) => void;
  generationLanguage?: import("@/lib/types").SupportedLanguage;
  onLanguageChange?: (lang: import("@/lib/types").SupportedLanguage) => void;
  onAdjustGenerate?: (opts: {
    adjustRecordingBarRef: React.RefObject<
      import("@/components/encounters/recording-bar").RecordingBarRef | null
    >;
    additionalNotes?: string;
  }) => Promise<void>;
  adjustDrawerOpen?: boolean;
  onAdjustDrawerOpenChange?: (open: boolean) => void;
  // Timer
  timerState?:
    | import("@/hooks/use-generation-timer").GenerationTimerState
    | null;
  // i18n
  t: (key: string) => string;
}

export function ReviewView({
  visit,
  setVisit,
  title,
  onTitleChange,
  onMetadataBlur,
  formattedDate,
  error,
  isRegenerating,
  isStreamingGeneration = false,
  selectedTemplateId,
  onRegenerate,
  streamedSections,
  streamingSectionLabels,
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
  onRetry,
  visitId,
  files,
  onFilesChange,
  generationLanguage,
  onLanguageChange,
  onAdjustGenerate,
  adjustDrawerOpen = false,
  onAdjustDrawerOpenChange,
  timerState,
  t,
}: ReviewViewProps) {
  const tDetail = useTranslations("encounters.detail");

  // Tab state — desktop uses "resources" | "note", mobile uses "note" | "codes"
  const [activeTab, setActiveTab] = useState("note");
  const [mobileTab, setMobileTab] = useState<"note" | "codes">("note");
  const [visibleTabs, setVisibleTabs] = useState<TabOption[]>([]);

  // Extracted hooks
  const {
    mobileHeaderHidden,
    mobileCollapsibleRef,
    onCollapsibleTransitionEnd,
    skipTransition,
  } = useMobileHeaderCollapse(activeTab);

  const { noteCopied, emailStatus, handleCopyNote, handleSendEmail } =
    useNoteActions({
      template,
      sectionContents,
      removedSections,
      sectionLabels,
      generatedNoteHtml,
      visitId: visit.id,
    });

  // Sticky header height — drives sidebar sticky offset + scroll-to-section offset
  const stickyHeaderRef = useRef<HTMLDivElement>(null);
  const noteHeaderRef = useRef<HTMLDivElement>(null);
  const [stickyHeaderHeight, setStickyHeaderHeight] = useState(0);
  const [noteHeaderHeight, setNoteHeaderHeight] = useState(0);
  useEffect(() => {
    const el = stickyHeaderRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStickyHeaderHeight(el.offsetHeight));
    ro.observe(el);
    setStickyHeaderHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = noteHeaderRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNoteHeaderHeight(el.offsetHeight));
    ro.observe(el);
    setNoteHeaderHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  // Tab configuration
  const allTabs: TabOption[] = useMemo(
    () => [
      { value: "resources", label: t("detail.resources") },
      { value: "note", label: t("detail.note") },
    ],
    [t],
  );

  const defaultVisibleTabs = allTabs;

  const currentVisibleTabs =
    visibleTabs.length > 0 ? visibleTabs : defaultVisibleTabs;

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

  /** Determine which section/subsection IDs have content and are not removed.
   *  During streaming, derive from streamed sections with meaningful content. */
  const documentedSectionIds = useMemo(() => {
    if (!template) return new Set<string>();
    let documented: Set<string>;
    if (isRegenerating || isStreamingGeneration) {
      documented = new Set(
        streamedSections
          .filter((s) => {
            const trimmed = s.content?.trim();
            return trimmed && !NOT_STATED_VALUES.has(trimmed);
          })
          .map((s) => s.id),
      );
    } else {
      documented = new Set<string>();
      for (const id of flattenSectionIds(template)) {
        if (!removedSections.has(id) && sectionContents[id]?.trim()) {
          documented.add(id);
        }
      }
    }
    // Mark parent sections as documented if any of their subsections are
    for (const section of template.sections) {
      if (section.subsections?.some((sub) => documented.has(sub.id))) {
        documented.add(section.id);
      }
    }
    return documented;
  }, [
    template,
    sectionContents,
    removedSections,
    isRegenerating,
    isStreamingGeneration,
    streamedSections,
  ]);

  // Scroll to a note section card by its template section ID.
  // Note: querySelectorAll is used because the same cards are rendered in both
  // the mobile and desktop layouts, creating duplicate IDs. We pick the visible one.
  const handleScrollToNoteSection = useCallback(
    (sectionId: string) => {
      const matches = document.querySelectorAll<HTMLElement>(
        `[id="note-section-${sectionId}"]`,
      );
      const el = Array.from(matches).find((e) => e.offsetHeight > 0);
      if (!el) return;

      // Find the overflow-y:auto scroll container
      let container: HTMLElement | null = el.parentElement;
      while (container) {
        const oy = getComputedStyle(container).overflowY;
        if (oy === "auto" || oy === "scroll") break;
        container = container.parentElement;
      }

      if (container) {
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const target =
          container.scrollTop +
          (elRect.top - containerRect.top) -
          stickyHeaderHeight -
          noteHeaderHeight -
          16;
        container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
      } else {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [stickyHeaderHeight, noteHeaderHeight],
  );

  // Switch to note tab before regeneration
  const handleRegenerateWithTabSwitch = useCallback(
    (templateId: string) => {
      setActiveTab("note");
      onRegenerate(templateId);
    },
    [onRegenerate],
  );

  const isActivelyStreaming = isRegenerating || isStreamingGeneration;

  // Shared note sections list (used in both mobile and desktop layouts)
  const noteSectionCards = (
    <NoteSectionsList
      template={template}
      isRegenerating={isRegenerating}
      isStreamingGeneration={isStreamingGeneration}
      streamedSections={streamedSections}
      streamingSectionLabels={streamingSectionLabels}
      sectionContents={sectionContents}
      removedSections={removedSections}
      sectionLabels={sectionLabels}
      onSectionContentChange={onSectionContentChange}
      onRemoveSection={onRemoveSection}
      focusSectionId={focusSectionId}
      onAutoFocused={onAutoFocused}
      noNoteLabel={t("detail.noNote")}
    />
  );

  // Shared error alert (used in both mobile and desktop layouts)
  const errorAlert = error ? (
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
  ) : null;

  // Streaming timer label (shared between mobile and desktop)
  const streamingTimerLabel = timerState
    ? tDetail("generatingReadyIn", { time: timerState.formattedTime })
    : isStreamingGeneration
      ? t("detail.generatingEncounter")
      : t("detail.regenerating");

  // Email button icon + label
  const emailIcon =
    emailStatus === "sending"
      ? Loading03Icon
      : emailStatus === "sent"
        ? Tick02Icon
        : emailStatus === "failed"
          ? AlertCircleIcon
          : Mail01Icon;
  const emailLabel =
    emailStatus === "sent"
      ? t("detail.emailSent")
      : emailStatus === "failed"
        ? t("detail.emailFailed")
        : t("detail.sendAsEmail");

  return (
    <>
      {/* ── MOBILE LAYOUT (< desktop breakpoint) ── */}
      <div className="flex flex-col gap-0 desktop:hidden">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 flex flex-col bg-background">
          {/* Collapsible part: title, date, template, buttons */}
          <div
            ref={mobileCollapsibleRef}
            className={`grid ${skipTransition ? "" : "transition-[grid-template-rows] duration-300 ease-in-out"}`}
            style={{
              gridTemplateRows: mobileHeaderHidden ? "0fr" : "1fr",
            }}
            onTransitionEnd={onCollapsibleTransitionEnd}
          >
            <div className="overflow-hidden">
              <div className="flex flex-col gap-4 pt-4 pb-2">
                <div className="flex min-w-0 flex-col gap-1">
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
                    <Badge
                      variant={`status-${visit.status}` as "status-started"}
                    >
                      {t(`status.${visit.status}`)}
                    </Badge>
                    <span className="text-sm text-foreground/65">
                      {formattedDate}
                    </span>
                  </div>
                </div>

                {/* Template picker + action buttons */}
                <div className="flex flex-col gap-2">
                  <TemplateSelector
                    value={selectedTemplateId}
                    onChange={handleRegenerateWithTabSwitch}
                    disabled={isActivelyStreaming}
                    size="lg"
                    label={t("detail.templateLabel")}
                  />
                  {isActivelyStreaming ? (
                    <TextShimmer
                      className="py-2 text-center text-sm tabular-nums"
                      duration={3}
                    >
                      {streamingTimerLabel}
                    </TextShimmer>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="lg"
                        className="flex-1"
                        onClick={handleSendEmail}
                        disabled={
                          !generatedNoteHtml || emailStatus === "sending"
                        }
                      >
                        <HugeiconsIcon
                          icon={emailIcon}
                          size={16}
                          className={
                            emailStatus === "sending"
                              ? "animate-spin"
                              : undefined
                          }
                        />
                        {emailLabel}
                      </Button>
                      <Button
                        variant="secondary"
                        size="lg"
                        className="flex-1"
                        onClick={handleCopyNote}
                        disabled={!generatedNoteHtml}
                      >
                        {noteCopied
                          ? t("detail.noteCopied")
                          : t("detail.copyNote")}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Always-visible tabs */}
          <div className="border-b border-border">
            <Tabs
              value={mobileTab}
              onValueChange={(v) => setMobileTab(v as "note" | "codes")}
            >
              <TabsList variant="line">
                <TabsTrigger value="note">{t("detail.note")}</TabsTrigger>
                <TabsTrigger value="codes">{t("detail.codes")}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        {errorAlert}

        {/* Mobile Note content */}
        {mobileTab === "note" && (
          <div className="flex flex-col gap-4 pt-4">
            <div className="flex flex-col gap-2">{noteSectionCards}</div>
          </div>
        )}

        {/* Mobile Codes content */}
        {mobileTab === "codes" && (
          <div className="flex flex-col gap-2 pt-4">
            <IcdPanelContent visit={visit} setVisit={setVisit} />
          </div>
        )}
      </div>

      {/* ── DESKTOP LAYOUT (>= desktop breakpoint) ── */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="hidden gap-0 desktop:flex desktop:flex-col"
      >
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
          </div>
        </div>

        {errorAlert}

        {/* Tab content — outside sticky area */}
        <TabsContent value="note">
          <div className="flex flex-1 gap-6">
            <div className="pt-6">
              <TemplateSidebar
                templateId={selectedTemplateId}
                template={template}
                onTemplateChange={handleRegenerateWithTabSwitch}
                disabled={isActivelyStreaming}
                documentedSections={documentedSectionIds}
                onScrollToSection={
                  isActivelyStreaming ? undefined : handleScrollToNoteSection
                }
                onAddSection={isActivelyStreaming ? undefined : onAddSection}
                stickyTop={stickyHeaderHeight + 24}
              />
            </div>
            <div className="flex flex-1 flex-col">
              <div
                ref={noteHeaderRef}
                className="sticky z-10 -mx-1 flex items-center justify-between bg-background px-1 pt-6 pb-4"
                style={{ top: stickyHeaderHeight }}
              >
                <h2 className="text-lg font-medium">{t("detail.note")}</h2>
                {isActivelyStreaming ? (
                  <TextShimmer className="text-sm tabular-nums" duration={3}>
                    {streamingTimerLabel}
                  </TextShimmer>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={handleSendEmail}
                      disabled={!generatedNoteHtml || emailStatus === "sending"}
                    >
                      <HugeiconsIcon
                        icon={emailIcon}
                        size={16}
                        className={
                          emailStatus === "sending" ? "animate-spin" : undefined
                        }
                      />
                      {emailLabel}
                    </Button>
                    <Button
                      variant="secondary"
                      size="lg"
                      onClick={handleCopyNote}
                      disabled={!generatedNoteHtml}
                    >
                      {noteCopied
                        ? t("detail.noteCopied")
                        : t("detail.copyNote")}
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">{noteSectionCards}</div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="resources" className="pt-6">
          <ResourcesPanel visit={visit} t={t} />
        </TabsContent>
      </Tabs>

      {/* Adjust drawer */}
      {onAdjustGenerate &&
        visitId &&
        files &&
        onFilesChange &&
        generationLanguage &&
        onLanguageChange &&
        onAdjustDrawerOpenChange && (
          <AdjustDrawer
            open={adjustDrawerOpen}
            onOpenChange={onAdjustDrawerOpenChange}
            visitId={visitId}
            metadata={visit.metadata}
            files={files}
            onFilesChange={onFilesChange}
            generationLanguage={generationLanguage}
            onLanguageChange={onLanguageChange}
            onAdjustGenerate={onAdjustGenerate}
            isProcessing={isActivelyStreaming}
            t={t}
          />
        )}
    </>
  );
}
