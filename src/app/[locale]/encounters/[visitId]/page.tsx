"use client";

import { useState, useEffect, useCallback, useRef, use, useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/nav/app-shell";
import { usePageTitle } from "@/components/nav/page-title-context";
import { EncounterHeaderActions } from "@/components/encounters/encounter-header-actions";
import { TemplateSidebar } from "@/components/encounters/template-sidebar";
import {
  FilesPanel,
  type EncounterFile,
} from "@/components/encounters/files-panel";
import { ProcessingOverlay } from "@/components/encounters/processing-overlay";
import { ReviewTabs, type ReviewTab } from "@/components/encounters/review-tabs";
import { NoteSectionCard } from "@/components/encounters/note-section-card";
import { PatientPanel } from "@/components/encounters/patient-panel";
import {
  RecordingBar,
  type RecordingBarRef,
} from "@/components/encounters/recording-bar";
import { Badge } from "@/components/shared/badge";
import { Button } from "@/components/shared/button";
import { Input } from "@/components/shared/input";
import { Alert, AlertDescription } from "@/components/shared/alert";
import { Skeleton } from "@/components/shared/skeleton";
import { HugeiconsIcon } from "@hugeicons/react";
import { AlertCircleIcon } from "@hugeicons/core-free-icons";
import { TiptapEditor } from "@/components/editor/tiptap-editor";
import { getDefaultTemplate, getTemplateById } from "@/lib/templates";
import {
  parseSoapSections,
  allSectionsToPlainText,
} from "@/lib/parse-soap-sections";
import type {
  Encounter,
  EncounterType,
  EncounterStatus,
  SupportedLanguage,
} from "@/lib/types";

interface PageProps {
  params: Promise<{ visitId: string }>;
}

function formatVisitDate(dateString: string, locale: string) {
  return new Date(dateString).toLocaleDateString(locale, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Statuses that show the draft-mode editor layout */
const DRAFT_STATUSES: EncounterStatus[] = ["started", "recording", "processing"];

export default function EncounterDetailPage({ params }: PageProps) {
  const { visitId } = use(params);
  const t = useTranslations("encounters");
  const tTemplates = useTranslations("templates");
  const tPoc = useTranslations("poc");
  const locale = useLocale();
  const router = useRouter();
  const { setPageTitle } = usePageTitle();

  // Visit state
  const [visit, setVisit] = useState<Encounter | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Metadata
  const [title, setTitle] = useState("");
  const [patientName, setPatientName] = useState("");
  const [patientId, setPatientId] = useState("");
  const [visitType, setEncounterType] = useState<EncounterType>("consultation");

  // Generation language
  const [generationLanguage, setGenerationLanguage] =
    useState<SupportedLanguage>("sk");

  // Template + generation
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    getDefaultTemplate().id
  );
  const [doctorNotes, setDoctorNotes] = useState("");
  const [generatedNoteHtml, setGeneratedNoteHtml] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  // Files
  const [files, setFiles] = useState<EncounterFile[]>([]);

  // Audio recording — blob kept in memory until Generate
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const recordingBarRef = useRef<RecordingBarRef>(null);

  // Review state
  const [activeTab, setActiveTab] = useState<ReviewTab>("note");
  const [noteCopied, setNoteCopied] = useState(false);

  const initialDoctorNotesRef = useRef("");

  const getLocalizedHref = (href: string) => {
    const base = locale === "sk" ? "" : `/${locale}`;
    return `${base}${href}`;
  };

  const updateTitle = useCallback(
    (newTitle: string) => {
      setTitle(newTitle);
      setPageTitle(newTitle || null);
      window.dispatchEvent(
        new CustomEvent("encounter-update", {
          detail: { id: visitId, title: newTitle || null },
        })
      );
    },
    [visitId, setPageTitle]
  );

  useEffect(() => {
    return () => setPageTitle(null);
  }, [setPageTitle]);

  // Fetch visit data
  useEffect(() => {
    const fetchVisit = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/encounters/${visitId}`);
        if (!res.ok) throw new Error("Visit not found");

        const data: Encounter = await res.json();
        setVisit(data);

        updateTitle(data.title || "");
        setPatientName(data.patient_name || "");
        setEncounterType(data.visit_type || "consultation");
        setGenerationLanguage((data.language as SupportedLanguage) || "sk");

        const meta = data.metadata as Record<string, unknown>;
        if (meta?.template_id) {
          setSelectedTemplateId(meta.template_id as string);
        }
        if (meta?.doctor_notes) {
          setDoctorNotes(meta.doctor_notes as string);
          initialDoctorNotesRef.current = meta.doctor_notes as string;
        }
        if (meta?.files) {
          setFiles(meta.files as EncounterFile[]);
        }
        if (meta?.patient_personal_id) {
          setPatientId(meta.patient_personal_id as string);
        }

        if (data.soap_note) {
          setGeneratedNoteHtml(data.soap_note);
        }
      } catch {
        setError("Failed to load visit");
      } finally {
        setIsLoading(false);
      }
    };

    fetchVisit();
  }, [visitId, updateTitle]);

  // Auto-save doctor notes (2s debounce)
  useEffect(() => {
    if (!visit || doctorNotes === initialDoctorNotesRef.current) return;

    const timeout = setTimeout(async () => {
      try {
        await fetch(`/api/encounters/${visitId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            metadata: { ...visit.metadata, doctor_notes: doctorNotes },
          }),
        });
        initialDoctorNotesRef.current = doctorNotes;
      } catch {
        // Silent fail
      }
    }, 2000);

    return () => clearTimeout(timeout);
  }, [doctorNotes, visit, visitId]);

  const handleMetadataBlur = async () => {
    if (!visit) return;

    const updates: Record<string, unknown> = {};
    if (title !== (visit.title || "")) updates.title = title.trim() || null;
    if (patientName !== (visit.patient_name || ""))
      updates.patient_name = patientName.trim() || null;
    if (visitType !== visit.visit_type) updates.visit_type = visitType;

    if (Object.keys(updates).length === 0) return;

    try {
      await fetch(`/api/encounters/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      setVisit((prev) =>
        prev ? ({ ...prev, ...updates } as Encounter) : prev
      );
    } catch {
      // Silent fail
    }
  };

  const handlePatientBlur = async () => {
    if (!visit) return;

    const updates: Record<string, unknown> = {};
    if (patientName !== (visit.patient_name || ""))
      updates.patient_name = patientName.trim() || null;

    const meta = (visit.metadata || {}) as Record<string, unknown>;
    const storedPersonalId = (meta.patient_personal_id as string) || "";
    if (patientId !== storedPersonalId) {
      updates.metadata = {
        ...meta,
        patient_personal_id: patientId.trim() || null,
      };
    }

    if (Object.keys(updates).length === 0) return;

    try {
      await fetch(`/api/encounters/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      setVisit((prev) =>
        prev ? ({ ...prev, ...updates } as Encounter) : prev
      );
    } catch {
      // Silent fail
    }
  };

  const handleRecordingComplete = useCallback((blob: Blob) => {
    setAudioBlob(blob);
  }, []);

  const handleRecordingStateChange = useCallback(
    (recordingState: "idle" | "recording" | "paused") => {
      const status = recordingState === "recording" ? "recording" : "started";
      setVisit((prev) => (prev ? { ...prev, status } : prev));
      window.dispatchEvent(
        new CustomEvent("encounter-update", {
          detail: { id: visitId, status },
        })
      );
      // Persist to DB (fire-and-forget)
      fetch(`/api/encounters/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).catch(() => {});
    },
    [visitId]
  );

  const handleGenerate = async () => {
    if (!visitId) return;
    setIsGenerating(true);
    setError(null);

    // Reflect processing state in sidebar
    window.dispatchEvent(
      new CustomEvent("encounter-update", {
        detail: { id: visitId, status: "processing" },
      })
    );

    try {
      // Finalize any in-progress recording first
      const finalizedBlob = recordingBarRef.current?.finalize();
      const blobToProcess = finalizedBlob ?? audioBlob;

      // Step 1: If there's a recorded audio blob, transcribe it first
      if (blobToProcess) {
        const audioFile = new File([blobToProcess], "recording.webm", {
          type: blobToProcess.type,
        });
        const formData = new FormData();
        formData.append("file", audioFile);
        formData.append("language", generationLanguage);
        formData.append("visitId", visitId);

        const transcribeRes = await fetch("/api/process-audio", {
          method: "POST",
          body: formData,
        });

        if (!transcribeRes.ok) {
          const data = await transcribeRes.json();
          throw new Error(data.error || tPoc("errorUpload"));
        }

        const transcribeData = await transcribeRes.json();
        setVisit((prev) =>
          prev
            ? { ...prev, raw_text: transcribeData.transcriptText }
            : prev
        );
        setAudioBlob(null); // consumed
      }

      // Step 2: Generate note from transcript + doctor notes
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitId,
          templateId: selectedTemplateId,
          doctorNotes: doctorNotes || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || tPoc("errorGenerate"));
      }

      const data = await res.json();
      setGeneratedNoteHtml(data.generatedNote);
      setVisit((prev) =>
        prev
          ? {
              ...prev,
              soap_note: data.generatedNote,
              patient_letter: data.letter,
            }
          : prev
      );

      // Auto-transition to review
      await fetch(`/api/encounters/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "to_review" }),
      });
      setVisit((prev) =>
        prev ? { ...prev, status: "to_review" } : prev
      );
      window.dispatchEvent(
        new CustomEvent("encounter-update", {
          detail: { id: visitId, status: "to_review" },
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : tPoc("errorGenerate"));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleMarkComplete = async () => {
    if (!visitId) return;

    try {
      const res = await fetch(`/api/encounters/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });

      if (!res.ok) throw new Error("Failed to update status");
      setVisit((prev) => (prev ? { ...prev, status: "completed" } : prev));
      window.dispatchEvent(
        new CustomEvent("encounter-update", {
          detail: { id: visitId, status: "completed" },
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
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
      router.push(getLocalizedHref(""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete visit");
    }
  };

  const handleLanguageChange = useCallback(
    async (lang: SupportedLanguage) => {
      setGenerationLanguage(lang);
      try {
        await fetch(`/api/encounters/${visitId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: lang }),
        });
        setVisit((prev) => (prev ? { ...prev, language: lang } : prev));
      } catch {
        // Silent fail
      }
    },
    [visitId]
  );

  const handleCopyNote = useCallback(async () => {
    const parsed = parseSoapSections(generatedNoteHtml);
    const text = allSectionsToPlainText(parsed);
    await navigator.clipboard.writeText(text);
    setNoteCopied(true);
    setTimeout(() => setNoteCopied(false), 2000);
  }, [generatedNoteHtml]);

  // Derived state
  const canGenerate = !!(visit?.raw_text || audioBlob || doctorNotes.trim());
  const isDraft = visit ? DRAFT_STATUSES.includes(visit.status) : true;

  const parsedSections = useMemo(
    () => parseSoapSections(generatedNoteHtml),
    [generatedNoteHtml]
  );

  const template = getTemplateById(selectedTemplateId);

  /** Match parsed sections to template sections by index (buildTemplateHtml iterates in order) */
  const documentedSectionIds = useMemo(() => {
    if (!template || !generatedNoteHtml) return new Set<string>();
    const documented = new Set<string>();
    template.sections.forEach((section, i) => {
      if (parsedSections[i] && parsedSections[i].content.trim()) {
        documented.add(section.id);
      }
    });
    return documented;
  }, [template, generatedNoteHtml, parsedSections]);

  // Loading state
  if (isLoading) {
    return (
      <AppShell>
        <div className="flex flex-1">
          <div className="flex flex-1 justify-center p-6">
            <div className="w-full max-w-[800px] space-y-6">
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
          <div className="w-[280px] shrink-0 border-l bg-sidebar p-6">
            <Skeleton className="mb-4 h-6 w-16" />
            <Skeleton className="h-[72px] w-full rounded-xl" />
          </div>
        </div>
      </AppShell>
    );
  }

  if (error && !visit) {
    return (
      <AppShell>
        <div className="p-6">
          <Alert variant="destructive">
            <HugeiconsIcon icon={AlertCircleIcon} size={16} />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      </AppShell>
    );
  }

  if (!visit) return null;

  return (
    <AppShell contentClassName="flex flex-1 overflow-hidden">
      {/* Header actions (portaled into app header) */}
      <EncounterHeaderActions
        status={visit.status}
        generationLanguage={generationLanguage}
        onLanguageChange={handleLanguageChange}
        onGenerate={handleGenerate}
        onMarkComplete={handleMarkComplete}
        onDelete={handleDelete}
        canGenerate={canGenerate}
        isGenerating={isGenerating}
      />

      {/* Processing overlay — takes over full content area */}
      {isGenerating && <ProcessingOverlay />}

      {/* Main content area — hidden during generation */}
      {!isGenerating && (
        <div className="flex flex-1 justify-center overflow-y-auto px-6 pt-4 pb-6">
          <div className="flex h-full w-full max-w-[800px] flex-col gap-6">
            {/* Title row */}
            <div className="flex items-center justify-between">
              {isDraft ? (
                <Input
                  value={title}
                  onChange={(e) => updateTitle(e.target.value)}
                  onBlur={handleMetadataBlur}
                  placeholder={t("untitled")}
                  className="h-auto border-none bg-transparent px-0 text-2xl md:text-2xl shadow-none placeholder:text-foreground/65 focus-visible:ring-0"
                />
              ) : (
                <h1 className="text-2xl text-muted-foreground">
                  {title || t("untitled")}
                </h1>
              )}
              <div className="flex shrink-0 items-center gap-3">
                {visit.status === "to_review" && (
                  <Button variant="outline" onClick={handleMarkComplete}>
                    {t("detail.markComplete")}
                  </Button>
                )}
                <Badge variant={`status-${visit.status}` as "status-started"}>
                  {t(`status.${visit.status}`)}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {formatVisitDate(visit.visit_date, locale)}
                </span>
              </div>
            </div>

            {/* Draft: recording bar */}
            {isDraft && (
              <RecordingBar
                ref={recordingBarRef}
                hasRecording={!!audioBlob}
                hasTranscript={!!visit.raw_text}
                disabled={isGenerating}
                onRecordingComplete={handleRecordingComplete}
                onRecordingStateChange={handleRecordingStateChange}
              />
            )}

            {/* Draft: separator */}
            {isDraft && <div className="h-px bg-border" />}

            {/* Error alert */}
            {error && (
              <Alert variant="destructive">
                <HugeiconsIcon icon={AlertCircleIcon} size={16} />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Draft: template sidebar + editor */}
            {isDraft && (
              <div className="flex flex-1 gap-6">
                <TemplateSidebar
                  templateId={selectedTemplateId}
                  onTemplateChange={setSelectedTemplateId}
                  disabled={isGenerating}
                />
                <TiptapEditor
                  content={doctorNotes}
                  onChange={setDoctorNotes}
                  placeholder={tTemplates("doctorNotesPlaceholder")}
                  className="flex-1 rounded-2xl"
                />
              </div>
            )}

            {/* Review/closed: tabs + content */}
            {!isDraft && (
              <>
                <ReviewTabs
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                />

                {/* Note tab */}
                {activeTab === "note" && (
                  <div className="flex flex-1 gap-6">
                    <TemplateSidebar
                      templateId={selectedTemplateId}
                      onTemplateChange={setSelectedTemplateId}
                      disabled
                      documentedSections={documentedSectionIds}
                    />
                    <div className="flex flex-1 flex-col gap-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-lg font-medium">
                          {t("detail.note")}
                        </h2>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleCopyNote}
                          disabled={!generatedNoteHtml}
                        >
                          {noteCopied
                            ? t("detail.noteCopied")
                            : t("detail.copyNote")}
                        </Button>
                      </div>
                      {parsedSections.length > 0 ? (
                        parsedSections.map((section) => (
                          <NoteSectionCard
                            key={section.id}
                            title={section.title}
                            content={section.content}
                          />
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {t("detail.noNote")}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Transcript tab */}
                {activeTab === "transcript" && (
                  <div className="flex-1">
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
                )}

                {/* Add document tab */}
                {activeTab === "add-document" && (
                  <div className="flex-1">
                    <TiptapEditor
                      content=""
                      onChange={() => {}}
                      placeholder={t("detail.addDocument")}
                      className="flex-1 rounded-2xl"
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Right panel — hidden during generation */}
      {!isGenerating &&
        (isDraft ? (
          <FilesPanel
            visitId={visitId}
            files={files}
            onFilesChange={setFiles}
            onAudioFileAdded={(blob) => setAudioBlob(blob)}
            hasAudioFile={!!audioBlob}
          />
        ) : (
          <PatientPanel
            patientName={patientName}
            patientId={patientId}
            onPatientNameChange={setPatientName}
            onPatientIdChange={setPatientId}
            onBlur={handlePatientBlur}
          />
        ))}
    </AppShell>
  );
}
