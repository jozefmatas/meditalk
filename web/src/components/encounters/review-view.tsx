"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Textarea } from "@/components/shared/textarea";
import { Badge } from "@/components/shared/badge";
import { ErrorAlert } from "@/components/shared/error-alert";
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
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/shared/accordion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  Mail01Icon,
  Tick02Icon,
  Loading03Icon,
  AlertCircleIcon,
  Mic01Icon,
  Note01Icon,
  File01Icon,
  Image01Icon,
} from "@hugeicons/core-free-icons";
import { NoteSectionCard } from "@/components/encounters/note-section-card";
import { TemplateSidebar } from "@/components/encounters/template-sidebar";
import { TemplateSelector } from "@/components/templates/template-selector";
import { IcdPanelContent } from "@/components/encounters/icd-panel";
import type { Template } from "@/lib/templates";
import { flattenSectionIds } from "@/lib/templates/html";
import {
  parseNoteSections,
  allSectionsToPlainText,
  NOT_STATED_VALUES,
  type NoteSection,
} from "@/lib/parse-note-sections";
import { buildTemplateHtml } from "@/lib/templates/html";
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
  t,
}: ReviewViewProps) {
  // Tab state — desktop uses "resources" | "note" | "add-document", mobile uses "note" | "codes"
  const [activeTab, setActiveTab] = useState("note");
  const [mobileTab, setMobileTab] = useState<"note" | "codes">("note");
  const [visibleTabs, setVisibleTabs] = useState<TabOption[]>([]);
  const [noteCopied, setNoteCopied] = useState(false);
  const [emailStatus, setEmailStatus] = useState<
    "idle" | "sending" | "sent" | "failed"
  >("idle");

  // Mobile header collapse on scroll — hide everything except tabs when scrolling down.
  // Locks during CSS transition so the animation always completes before reversing.
  const [mobileHeaderHidden, setMobileHeaderHidden] = useState(false);
  const mobileCollapsibleRef = useRef<HTMLDivElement>(null);
  const anchorY = useRef(0);
  const isHidden = useRef(false);
  const transitioning = useRef(false);

  const onCollapsibleTransitionEnd = useCallback(() => {
    transitioning.current = false;
  }, []);

  // Auto-expand header when switching tabs — the new tab's content may be too
  // short to scroll, so the scroll-based reveal would never fire.
  useEffect(() => {
    if (isHidden.current) {
      isHidden.current = false;
      transitioning.current = true;
      setMobileHeaderHidden(false);
    }
  }, [activeTab]);

  useEffect(() => {
    const scrollParent = mobileCollapsibleRef.current?.closest(
      "[style*='overflow'], .overflow-y-auto, .overflow-auto",
    ) as HTMLElement | null;
    const target = scrollParent || window;

    const getScrollY = () =>
      scrollParent ? scrollParent.scrollTop : window.scrollY;

    anchorY.current = getScrollY();

    const handleScroll = () => {
      if (transitioning.current) return;

      const currentY = getScrollY();
      const delta = currentY - anchorY.current;

      if (!isHidden.current && delta > 40 && currentY > 80) {
        // Don't collapse if the content barely overflows — collapsing the header
        // would remove the overflow entirely, leaving no way to scroll back up.
        // Use 2x header height as threshold to account for mobile browser chrome
        // (address bar, bottom toolbar) which dynamically changes viewport size.
        const el = scrollParent || document.documentElement;
        const collapsibleH = mobileCollapsibleRef.current?.scrollHeight ?? 0;
        const scrollableOverflow = el.scrollHeight - el.clientHeight;
        if (scrollableOverflow < collapsibleH * 2) {
          anchorY.current = currentY;
          return;
        }

        isHidden.current = true;
        transitioning.current = true;
        setMobileHeaderHidden(true);
        anchorY.current = currentY;
      } else if (isHidden.current && (delta < -30 || currentY < 40)) {
        isHidden.current = false;
        transitioning.current = true;
        setMobileHeaderHidden(false);
        anchorY.current = currentY;
      }

      // Move anchor when continuing same direction
      if (isHidden.current && delta > 0) anchorY.current = currentY;
      if (!isHidden.current && delta < 0) anchorY.current = currentY;
    };

    target.addEventListener("scroll", handleScroll, { passive: true });
    return () => target.removeEventListener("scroll", handleScroll);
  }, []);

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
    const parsed = parseNoteSections(currentHtml);
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

  // Send current note via email
  const handleSendEmail = useCallback(async () => {
    if (emailStatus === "sending") return;
    setEmailStatus("sending");
    try {
      const res = await fetch("/api/send-note-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitId: visit.id }),
      });
      if (!res.ok) throw new Error("Failed");
      setEmailStatus("sent");
      setTimeout(() => setEmailStatus("idle"), 3000);
    } catch {
      setEmailStatus("failed");
      setTimeout(() => setEmailStatus("idle"), 3000);
    }
  }, [visit.id, emailStatus]);

  // Note section cards — shared between desktop note tab and mobile note tab
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

  const noteSectionCards =
    isActivelyStreaming && template ? (
      <>
        {/* During streaming: use template hierarchy (sections + subsections).
          Completed sections show real content; pending ones show skeleton lines.
          Received-but-empty sections are hidden entirely (no flash). */}
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
    ) : isActivelyStreaming ? (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    ) : template && Object.keys(sectionContents).length > 0 ? (
      template.sections
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
          />
        ))
    ) : (
      <p className="text-sm text-muted-foreground">{t("detail.noNote")}</p>
    );

  return (
    <>
      {/* ── MOBILE LAYOUT (< desktop breakpoint) ── */}
      <div className="flex flex-col gap-0 desktop:hidden">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 flex flex-col bg-background">
          {/* Collapsible part: title, date, template, buttons */}
          <div
            ref={mobileCollapsibleRef}
            className="grid transition-[grid-template-rows] duration-300 ease-in-out"
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
                      className="py-2 text-center text-sm"
                      duration={3}
                    >
                      {isStreamingGeneration
                        ? t("detail.generatingEncounter")
                        : t("detail.regenerating")}
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
                          icon={
                            emailStatus === "sending"
                              ? Loading03Icon
                              : emailStatus === "sent"
                                ? Tick02Icon
                                : emailStatus === "failed"
                                  ? AlertCircleIcon
                                  : Mail01Icon
                          }
                          size={16}
                          className={
                            emailStatus === "sending"
                              ? "animate-spin"
                              : undefined
                          }
                        />
                        {emailStatus === "sent"
                          ? t("detail.emailSent")
                          : emailStatus === "failed"
                            ? t("detail.emailFailed")
                            : t("detail.sendAsEmail")}
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
                  <TextShimmer className="text-sm" duration={3}>
                    {isStreamingGeneration
                      ? t("detail.generatingEncounter")
                      : t("detail.regenerating")}
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
                        icon={
                          emailStatus === "sending"
                            ? Loading03Icon
                            : emailStatus === "sent"
                              ? Tick02Icon
                              : emailStatus === "failed"
                                ? AlertCircleIcon
                                : Mail01Icon
                        }
                        size={16}
                        className={
                          emailStatus === "sending" ? "animate-spin" : undefined
                        }
                      />
                      {emailStatus === "sent"
                        ? t("detail.emailSent")
                        : emailStatus === "failed"
                          ? t("detail.emailFailed")
                          : t("detail.sendAsEmail")}
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
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  ResourcesPanel                                                     */
/* ------------------------------------------------------------------ */

interface ResourcesPanelProps {
  visit: Encounter;
  t: (key: string) => string;
}

interface EncounterFile {
  name: string;
  type: string;
  extracted_text?: string | null;
  source?: string;
}

function iconForFileType(type: string) {
  if (type.startsWith("audio/")) return Mic01Icon;
  if (type.startsWith("image/")) return Image01Icon;
  return File01Icon;
}

function resourceTypeLabelKey(file: EncounterFile): string {
  if (file.source === "recording") return "detail.resourceTypeRecording";
  if (file.type.startsWith("audio/")) return "detail.resourceTypeAudio";
  if (file.type.startsWith("image/")) return "detail.resourceTypeImage";
  return "detail.resourceTypeFile";
}

function ResourcesPanel({ visit, t }: ResourcesPanelProps) {
  const meta = visit.metadata as Record<string, unknown> | undefined;
  const doctorNotes = (meta?.doctor_notes as string) || "";
  const files = ((meta?.files as EncounterFile[]) || []).filter((f) =>
    f.extracted_text?.trim(),
  );
  const transcript = visit.raw_text || "";

  const hasTranscript = transcript.trim().length > 0;
  const hasDoctorNotes = doctorNotes.trim().length > 0;
  const hasFiles = files.length > 0;
  const hasAnything = hasTranscript || hasDoctorNotes || hasFiles;

  // First non-empty section starts open
  const defaultOpen = hasTranscript
    ? ["transcript"]
    : hasDoctorNotes
      ? ["notes"]
      : hasFiles
        ? ["file-0"]
        : [];

  if (!hasAnything) {
    return (
      <p className="text-sm text-muted-foreground">{t("detail.noResources")}</p>
    );
  }

  return (
    <Accordion
      type="multiple"
      defaultValue={defaultOpen}
      className="flex flex-col gap-3"
    >
      {hasTranscript && (
        <AccordionItem value="transcript" variant="bordered">
          <AccordionTrigger icon={Mic01Icon}>
            {t("detail.recordingTranscript")}
          </AccordionTrigger>
          <AccordionContent>
            <pre className="whitespace-pre-wrap text-sm text-foreground/80 font-sans">
              {transcript}
            </pre>
          </AccordionContent>
        </AccordionItem>
      )}
      {hasDoctorNotes && (
        <AccordionItem value="notes" variant="bordered">
          <AccordionTrigger icon={Note01Icon}>
            {t("detail.doctorNotes")}
          </AccordionTrigger>
          <AccordionContent>
            <pre className="whitespace-pre-wrap text-sm text-foreground/80 font-sans">
              {doctorNotes}
            </pre>
          </AccordionContent>
        </AccordionItem>
      )}
      {files.map((file, i) => (
        <AccordionItem
          key={file.name + i}
          value={`file-${i}`}
          variant="bordered"
        >
          <AccordionTrigger icon={iconForFileType(file.type)}>
            <span className="truncate">{file.name}</span>
            <Badge variant="status-started" className="ml-2 shrink-0">
              {t(resourceTypeLabelKey(file))}
            </Badge>
          </AccordionTrigger>
          <AccordionContent>
            <pre className="whitespace-pre-wrap text-sm text-foreground/80 font-sans">
              {file.extracted_text}
            </pre>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
