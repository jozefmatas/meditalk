"use client";

import { use, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/nav/app-shell";
import { usePageTitle } from "@/components/nav/page-title-context";
import { EncounterHeaderActions } from "@/components/encounters/encounter-header-actions";
import {
  FilesPanel,
  hasUploadingFiles,
} from "@/components/encounters/files-panel";
import { ProcessingOverlay } from "@/components/encounters/processing-overlay";
import { IcdPanel } from "@/components/encounters/icd-panel";
import { DraftView } from "@/components/encounters/draft-view";
import { ReviewView } from "@/components/encounters/review-view";
import { MobileDraftBottomBar } from "@/components/encounters/mobile-draft-bottom-bar";
import { MobileReviewBottomBar } from "@/components/encounters/mobile-review-bottom-bar";
import { Alert, AlertDescription } from "@/components/shared/alert";
import { Button } from "@/components/shared/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shared/dialog";
import { Skeleton } from "@/components/shared/skeleton";
import { HugeiconsIcon } from "@hugeicons/react";
import { AlertCircleIcon } from "@hugeicons/core-free-icons";
import { buildSectionLabelsFromTemplate } from "@/lib/templates";
import { useTemplate } from "@/hooks/use-template";
import type { Encounter, EncounterType } from "@/lib/types";
import { getTranscript } from "@/lib/encounters/sources";

import { useEncounterData } from "@/components/encounters/hooks/use-encounter-data";
import { useEncounterMetadata } from "@/components/encounters/hooks/use-encounter-metadata";
import { useEncounterGeneration } from "@/components/encounters/hooks/use-encounter-generation";
import { useSectionEditing } from "@/components/encounters/hooks/use-section-editing";

interface PageProps {
  params: Promise<{ visitId: string }>;
}

function formatVisitDate(dateString: string, locale: string) {
  const formatted = new Date(dateString).toLocaleDateString(locale, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

export default function EncounterDetailPage({ params }: PageProps) {
  const { visitId } = use(params);
  const t = useTranslations("encounters");
  const locale = useLocale();
  const router = useRouter();
  const { setPageTitle } = usePageTitle();

  // Refs to break circular dependency: data hook's onLoaded needs metadata
  // setters, but metadata hook needs data hook's visit/setVisit.
  // useState setters are stable so ref wiring is safe.
  const metadataSettersRef = useRef<{
    setTitle: (v: string) => void;
    setPatientName: (v: string) => void;
    setPatientId: (v: string) => void;
    setVisitType: (v: EncounterType) => void;
  }>({
    setTitle: () => {},
    setPatientName: () => {},
    setPatientId: () => {},
    setVisitType: () => {},
  });
  const updateTitleRef = useRef<(v: string) => void>(() => {});
  const initGenerationRef = useRef<(v: Encounter) => void>(() => {});

  // --- Data hook (fetch + event listeners) ---
  const data = useEncounterData({
    visitId,
    locale,
    router,
    onLoaded: useCallback((visit: Encounter) => {
      updateTitleRef.current(visit.title || "");
      metadataSettersRef.current.setPatientName(visit.patient_name || "");
      metadataSettersRef.current.setVisitType(
        visit.visit_type || "consultation",
      );
      const meta = visit.metadata as Record<string, unknown>;
      if (meta?.patient_personal_id) {
        metadataSettersRef.current.setPatientId(
          meta.patient_personal_id as string,
        );
      }
      initGenerationRef.current(visit);
    }, []),
  });

  // --- Metadata hook (single instance, with live visit) ---
  const metadata = useEncounterMetadata({
    visitId,
    visit: data.visit,
    setVisit: data.setVisit,
  });

  // Wire refs to actual setters
  metadataSettersRef.current = {
    setTitle: metadata.setTitle,
    setPatientName: metadata.setPatientName,
    setPatientId: metadata.setPatientId,
    setVisitType: metadata.setVisitType,
  };

  // --- updateTitle bridges metadata + page title + sidebar ---
  const { setTitle: setMetadataTitle } = metadata;
  const updateTitle = useCallback(
    (newTitle: string) => {
      setMetadataTitle(newTitle);
      setPageTitle(newTitle || null);
      window.dispatchEvent(
        new CustomEvent("encounter-update", {
          detail: { id: visitId, title: newTitle || null },
        }),
      );
    },
    [visitId, setPageTitle, setMetadataTitle],
  );
  updateTitleRef.current = updateTitle;

  useEffect(() => {
    return () => setPageTitle(null);
  }, [setPageTitle]);

  // Refresh encounter data when file extraction completes in the background.
  // Debounce: when multiple files finish extracting in rapid succession (e.g. 5
  // files uploaded at once), batch into a single refresh instead of 5 fetches.
  const { refreshEncounter } = data;
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        refreshEncounter();
        debounceTimer = null;
      }, 500);
    };
    window.addEventListener("extraction-complete", handler);
    return () => {
      window.removeEventListener("extraction-complete", handler);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [refreshEncounter]);

  // --- Generation hook ---
  const generation = useEncounterGeneration({
    visitId,
    visit: data.visit,
    setVisit: data.setVisit,
    setError: data.setError,
    updateTitle,
    setFiles: data.setFiles,
  });

  // Wire generation init ref
  initGenerationRef.current = generation.initFromVisit;

  // Keep generation's titleRef in sync
  const { syncTitle } = generation;
  useEffect(() => {
    syncTitle(metadata.title);
  }, [metadata.title, syncTitle]);

  // Template + section labels (shared between generation and section editing)
  const { template } = useTemplate(generation.selectedTemplateId);
  const sectionLabels = useMemo(() => {
    if (!template) return {};
    return buildSectionLabelsFromTemplate(template, locale);
  }, [template, locale]);

  // --- Section editing hook ---
  const sections = useSectionEditing({
    visitId,
    template,
    sectionLabels,
    generatedNoteHtml: generation.generatedNoteHtml,
    setGeneratedNoteHtml: generation.setGeneratedNoteHtml,
    setVisit: data.setVisit,
  });

  // --- Retry handler ---
  const handleRetry = useCallback(() => {
    data.setError(null);
    generation.handleGenerate();
  }, [data, generation]);

  // --- Derived state ---
  // Only block while bytes are still in flight to the server. OCR /
  // extraction happens server-side and is fully handled by the generate
  // endpoint (which waits for any pending extraction to land). Doctors
  // don't wait for a light to turn green — they click, and the server
  // does the waiting.
  const filesUploading = hasUploadingFiles(data.files);
  const canGenerate =
    !!(
      getTranscript(data.visit?.metadata as Record<string, unknown> | null) ||
      generation.audioBlob ||
      generation.doctorNotes.trim() ||
      data.files.length > 0 ||
      generation.hasActiveRecording
    ) && !filesUploading;
  const isDraft = data.visit
    ? data.visit.status === "started" || data.visit.status === "recording"
    : true;
  const formattedDate = data.visit
    ? formatVisitDate(data.visit.visit_date, locale)
    : "";

  // --- Page-level handlers ---
  const handleMarkComplete = async () => {
    if (!visitId) return;
    try {
      const res = await fetch(`/api/encounters/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      data.setVisit((prev) => (prev ? { ...prev, status: "completed" } : prev));
      window.dispatchEvent(
        new CustomEvent("encounter-update", {
          detail: { id: visitId, status: "completed" },
        }),
      );
    } catch (err) {
      data.setError(
        err instanceof Error ? err.message : "Failed to update status",
      );
    }
  };

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [adjustDrawerOpen, setAdjustDrawerOpen] = useState(false);

  const handleDelete = () => setDeleteDialogOpen(true);

  const confirmDelete = async () => {
    if (!visitId) return;
    setDeleteDialogOpen(false);
    try {
      const res = await fetch(`/api/encounters/${visitId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete visit");
      const base = locale === "sk" ? "" : `/${locale}`;
      router.push(base || "/");
    } catch (err) {
      data.setError(
        err instanceof Error ? err.message : "Failed to delete visit",
      );
    }
  };

  // --- Loading / error states ---
  if (data.isLoading) {
    return (
      <AppShell contentClassName="flex flex-1 overflow-hidden">
        <div className="flex flex-1 justify-center p-6">
          <div className="w-full max-w-5xl space-y-6">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-9 w-48" />
            <div className="h-px bg-border" />
            <div className="flex gap-6">
              <div className="hidden w-60 space-y-2 desktop:block">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
              <Skeleton className="h-96 flex-1 rounded-2xl" />
            </div>
          </div>
        </div>
        <div className="hidden h-full w-72 shrink-0 flex-col gap-8 border-l bg-background p-6 desktop:flex">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-18 w-full rounded-xl" />
        </div>
      </AppShell>
    );
  }

  if (data.error && !data.visit) {
    return (
      <AppShell>
        <div className="p-6">
          <Alert variant="destructive">
            <HugeiconsIcon icon={AlertCircleIcon} size={16} />
            <AlertDescription>{data.error}</AlertDescription>
          </Alert>
        </div>
      </AppShell>
    );
  }

  if (!data.visit) return null;

  return (
    <AppShell contentClassName="flex flex-1 overflow-hidden">
      {/* Header actions (portaled into app header) */}
      <EncounterHeaderActions
        status={data.visit.status}
        generationLanguage={generation.generationLanguage}
        onLanguageChange={generation.handleLanguageChange}
        onGenerate={generation.handleGenerate}
        onMarkComplete={handleMarkComplete}
        onDelete={handleDelete}
        canGenerate={canGenerate}
        onAdjust={() => setAdjustDrawerOpen(true)}
      />

      {/* Streaming generation view — show sections progressively */}
      {generation.isStreaming ? (
        <div className="flex flex-1 justify-center overflow-y-auto px-4 pb-6 desktop:px-6">
          <div className="flex w-full max-w-5xl flex-col gap-6 min-h-full">
            <ReviewView
              visit={data.visit}
              setVisit={data.setVisit}
              title={metadata.title}
              onTitleChange={updateTitle}
              onMetadataBlur={metadata.handleMetadataBlur}
              formattedDate={formattedDate}
              error={data.error}
              isRegenerating={false}
              isStreamingGeneration
              selectedTemplateId={generation.selectedTemplateId}
              onRegenerate={generation.handleRegenerate}
              streamedSections={generation.streamedSections}
              streamingSectionLabels={generation.streamingSectionLabels}
              generatedNoteHtml={generation.generatedNoteHtml}
              template={template}
              sectionLabels={sectionLabels}
              sectionContents={sections.sectionContents}
              removedSections={sections.removedSections}
              onSectionContentChange={sections.handleSectionContentChange}
              onRemoveSection={sections.handleRemoveSection}
              onAddSection={sections.handleAddSection}
              focusSectionId={sections.focusSectionId}
              onAutoFocused={sections.handleAutoFocused}
              onRetry={handleRetry}
              visitId={visitId}
              files={data.files}
              onFilesChange={data.setFiles}
              generationLanguage={generation.generationLanguage}
              onLanguageChange={generation.handleLanguageChange}
              onAdjustGenerate={generation.handleAdjustGenerate}
              adjustDrawerOpen={adjustDrawerOpen}
              onAdjustDrawerOpenChange={setAdjustDrawerOpen}
              timerState={generation.timerState}
              t={t}
            />
            <div aria-hidden className="min-h-32 shrink-0" />
          </div>
        </div>
      ) : generation.isGenerating || data.visit.status === "processing" ? (
        /* Processing overlay — server generating, SSE not connected.
         * `isGenerating` keeps the overlay pinned during the entire
         * client-driven generation lifecycle so the UI never falls back
         * to DraftView if visit.status gets transiently reset by a stray
         * event or stale poll response. */
        <ProcessingOverlay />
      ) : isDraft ? (
        /* Draft mode — recording + editor */
        <>
          <div className="flex flex-1 justify-center px-4 pb-6 desktop:px-6 overflow-hidden">
            <div className="flex w-full max-w-5xl flex-col gap-3 min-h-0 desktop:gap-6">
              <DraftView
                visit={data.visit}
                title={metadata.title}
                onTitleChange={updateTitle}
                onMetadataBlur={metadata.handleMetadataBlur}
                formattedDate={formattedDate}
                error={data.error}
                recordingBarRef={generation.recordingBarRef}
                onRecordingComplete={() => {}}
                onRecordingStateChange={generation.handleRecordingStateChange}
                selectedTemplateId={generation.selectedTemplateId}
                onTemplateChange={generation.handleTemplateChange}
                template={template}
                generationLanguage={generation.generationLanguage}
                doctorNotes={generation.doctorNotes}
                onDoctorNotesChange={generation.setDoctorNotes}
                visitId={visitId}
                files={data.files}
                onFilesChange={data.setFiles}
                saveStatus={generation.saveStatus}
                onRetry={handleRetry}
                t={t}
              />
            </div>
          </div>

          {/* Mobile bottom bar — draft only */}
          <MobileDraftBottomBar
            generationLanguage={generation.generationLanguage}
            onLanguageChange={generation.handleLanguageChange}
            onGenerate={generation.handleGenerate}
            canGenerate={canGenerate}
          />

          {/* Right panel — files */}
          <FilesPanel
            visitId={visitId}
            files={data.files}
            onFilesChange={data.setFiles}
            hasActiveRecording={generation.hasActiveRecording}
          />
        </>
      ) : (
        /* Review mode — generated note */
        <>
          <div className="flex flex-1 justify-center px-4 pb-6 desktop:px-6 overflow-y-auto">
            <div className="flex w-full max-w-5xl flex-col gap-6 min-h-full">
              <ReviewView
                visit={data.visit}
                setVisit={data.setVisit}
                title={metadata.title}
                onTitleChange={updateTitle}
                onMetadataBlur={metadata.handleMetadataBlur}
                formattedDate={formattedDate}
                error={data.error}
                isRegenerating={generation.isRegenerating}
                selectedTemplateId={generation.selectedTemplateId}
                onRegenerate={generation.handleRegenerate}
                streamedSections={generation.streamedSections}
                generatedNoteHtml={generation.generatedNoteHtml}
                template={template}
                sectionLabels={sectionLabels}
                sectionContents={sections.sectionContents}
                removedSections={sections.removedSections}
                onSectionContentChange={sections.handleSectionContentChange}
                onRemoveSection={sections.handleRemoveSection}
                onAddSection={sections.handleAddSection}
                focusSectionId={sections.focusSectionId}
                onAutoFocused={sections.handleAutoFocused}
                onRetry={handleRetry}
                visitId={visitId}
                files={data.files}
                onFilesChange={data.setFiles}
                generationLanguage={generation.generationLanguage}
                onLanguageChange={generation.handleLanguageChange}
                onAdjustGenerate={generation.handleAdjustGenerate}
                adjustDrawerOpen={adjustDrawerOpen}
                onAdjustDrawerOpenChange={setAdjustDrawerOpen}
                t={t}
              />
              <div aria-hidden className="min-h-32 shrink-0" />
            </div>
          </div>

          {/* Mobile bottom bar — review mode only */}
          <MobileReviewBottomBar
            onAdjust={() => setAdjustDrawerOpen(true)}
            isProcessing={generation.isRegenerating}
          />

          {/* Right panel — ICD codes */}
          <IcdPanel visit={data.visit} setVisit={data.setVisit} />
        </>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("delete.title")}</DialogTitle>
            <DialogDescription>{t("delete.message")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              {t("delete.cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              {t("delete.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
