"use client";

import { use, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/nav/app-shell";
import { usePageTitle } from "@/components/nav/page-title-context";
import { EncounterHeaderActions } from "@/components/encounters/encounter-header-actions";
import { FilesPanel } from "@/components/encounters/files-panel";
import { ProcessingOverlay } from "@/components/encounters/processing-overlay";
import { IcdPanel } from "@/components/encounters/icd-panel";
import { DraftView } from "@/components/encounters/draft-view";
import { ReviewView } from "@/components/encounters/review-view";
import { Alert, AlertDescription } from "@/components/shared/alert";
import { Skeleton } from "@/components/shared/skeleton";
import { HugeiconsIcon } from "@hugeicons/react";
import { AlertCircleIcon } from "@hugeicons/core-free-icons";
import { getTemplateById } from "@/lib/templates";
import { flattenSectionIds } from "@/lib/templates/html";
import type { Encounter, EncounterStatus, EncounterType } from "@/lib/types";

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

/** Statuses that show the draft-mode editor layout */
const DRAFT_STATUSES: EncounterStatus[] = [
  "started",
  "recording",
  "processing",
];

export default function EncounterDetailPage({ params }: PageProps) {
  const { visitId } = use(params);
  const t = useTranslations("encounters");
  const tTemplates = useTranslations("templates");
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
  const template = getTemplateById(generation.selectedTemplateId);
  const sectionLabels = useMemo(() => {
    if (!template) return {};
    const labels: Record<string, string> = {};
    for (const id of flattenSectionIds(template)) {
      labels[id] = tTemplates(`sections.${id}`);
    }
    return labels;
  }, [template, tTemplates]);

  // --- Section editing hook ---
  const sections = useSectionEditing({
    visitId,
    template,
    sectionLabels,
    generatedNoteHtml: generation.generatedNoteHtml,
    setGeneratedNoteHtml: generation.setGeneratedNoteHtml,
    setVisit: data.setVisit,
  });

  // --- Derived state ---
  const canGenerate = !!(
    data.visit?.raw_text ||
    generation.audioBlob ||
    generation.doctorNotes.trim() ||
    data.files.length > 0
  );
  const isDraft = data.visit
    ? DRAFT_STATUSES.includes(data.visit.status)
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

  const handleDelete = async () => {
    if (!visitId) return;
    if (!confirm(t("delete.message"))) return;
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
          <div className="w-full max-w-[960px] space-y-6">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-9 w-48" />
            <div className="h-px bg-border" />
            <div className="flex gap-6">
              <div className="w-60 space-y-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
              <Skeleton className="h-96 flex-1 rounded-2xl" />
            </div>
          </div>
        </div>
        <div className="flex h-full w-[280px] shrink-0 flex-col gap-8 border-l bg-background p-6">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-[72px] w-full rounded-xl" />
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
        isGenerating={generation.isGenerating}
      />

      {/* Processing overlay — takes over full content area */}
      {generation.isGenerating && <ProcessingOverlay />}

      {/* Main content area — hidden during generation */}
      {!generation.isGenerating && (
        <div
          className={`flex flex-1 justify-center px-6 pb-6 ${isDraft ? "overflow-hidden" : "overflow-y-auto"}`}
        >
          <div
            className={`flex w-full max-w-[960px] flex-col gap-6 ${isDraft ? "min-h-0" : "min-h-full"}`}
          >
            {isDraft ? (
              <DraftView
                visit={data.visit}
                title={metadata.title}
                onTitleChange={updateTitle}
                onMetadataBlur={metadata.handleMetadataBlur}
                formattedDate={formattedDate}
                error={data.error}
                recordingBarRef={generation.recordingBarRef}
                isGenerating={generation.isGenerating}
                onRecordingComplete={generation.handleRecordingComplete}
                onRecordingStateChange={generation.handleRecordingStateChange}
                selectedTemplateId={generation.selectedTemplateId}
                onTemplateChange={generation.handleTemplateChange}
                template={template}
                doctorNotes={generation.doctorNotes}
                onDoctorNotesChange={generation.setDoctorNotes}
                t={t}
                tTemplates={tTemplates}
              />
            ) : (
              <ReviewView
                visit={data.visit}
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
                onMarkComplete={handleMarkComplete}
                t={t}
                tTemplates={tTemplates}
              />
            )}

            {/* Bottom scroll inset (review mode only) */}
            {!isDraft && <div aria-hidden className="min-h-32 shrink-0" />}
          </div>
        </div>
      )}

      {/* Right panel — hidden during generation */}
      {!generation.isGenerating &&
        (isDraft ? (
          <FilesPanel
            visitId={visitId}
            files={data.files}
            onFilesChange={data.setFiles}
            onAudioBlobReady={(blob) => generation.setAudioBlob(blob)}
          />
        ) : (
          <IcdPanel
            visit={data.visit}
            setVisit={data.setVisit}
          />
        ))}
    </AppShell>
  );
}
