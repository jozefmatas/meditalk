"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/nav/app-shell";
import { usePageTitle } from "@/components/nav/page-title-context";
import { Button } from "@/components/shared/button";
import { Input } from "@/components/shared/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/shared/card";
import { ScrollArea } from "@/components/shared/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/shared/tabs";
import { Alert, AlertDescription } from "@/components/shared/alert";
import { Skeleton } from "@/components/shared/skeleton";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Search01Icon,
  Loading03Icon,
  AlertCircleIcon,
  MagicWand01Icon,
  Note01Icon,
  Delete01Icon,
  Tick01Icon,
  FloppyDiskIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { TiptapEditor } from "@/components/editor/tiptap-editor";
import { TemplateSelector } from "@/components/templates/template-selector";
import { AudioSection } from "@/components/visits/audio-section";
import { getDefaultTemplate } from "@/lib/templates";
import type { Visit, ChunkMatch, VisitType } from "@/lib/types";

const VISIT_TYPES: VisitType[] = [
  "consultation",
  "follow_up",
  "preventive",
  "acute",
  "specialist_referral",
  "telemedicine",
  "home_visit",
];

interface PageProps {
  params: Promise<{ visitId: string }>;
}

export default function VisitDetailPage({ params }: PageProps) {
  const { visitId } = use(params);
  const t = useTranslations("encounters");
  const tTemplates = useTranslations("templates");
  const tPoc = useTranslations("poc");
  const locale = useLocale();
  const router = useRouter();
  const { setPageTitle } = usePageTitle();

  // Visit state
  const [visit, setVisit] = useState<Visit | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Metadata form state
  const [title, setTitle] = useState("");
  const [patientName, setPatientName] = useState("");
  const [visitType, setVisitType] = useState<VisitType>("consultation");

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<ChunkMatch[]>([]);

  // Template + generation state
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    getDefaultTemplate().id
  );
  const [doctorNotes, setDoctorNotes] = useState("");
  const [generatedNoteHtml, setGeneratedNoteHtml] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");

  // Track initial doctor notes for debounced save
  const initialDoctorNotesRef = useRef("");

  const getLocalizedHref = (href: string) => {
    const base = locale === "sk" ? "" : `/${locale}`;
    return `${base}${href}`;
  };

  // Update header breadcrumb + sidebar title synchronously
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

  // Clear page title on unmount
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

        const data: Visit = await res.json();
        setVisit(data);

        // Populate form fields + sync title to header/sidebar
        updateTitle(data.title || "");
        setPatientName(data.patient_name || "");
        setVisitType(data.visit_type || "consultation");

        // Restore previous state from metadata
        const meta = data.metadata as Record<string, unknown>;
        if (meta?.template_id) {
          setSelectedTemplateId(meta.template_id as string);
        }
        if (meta?.doctor_notes) {
          setDoctorNotes(meta.doctor_notes as string);
          initialDoctorNotesRef.current = meta.doctor_notes as string;
        }

        // Load existing generated note
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
        // Silent fail for auto-save
      }
    }, 2000);

    return () => clearTimeout(timeout);
  }, [doctorNotes, visit, visitId]);

  // Save metadata on blur
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
      setVisit((prev) => (prev ? { ...prev, ...updates } as Visit : prev));
    } catch {
      // Silent fail
    }
  };

  const handleTranscriptReady = (rawText: string) => {
    setVisit((prev) => (prev ? { ...prev, raw_text: rawText } : prev));
  };

  const handleSearch = async () => {
    if (!searchQuery.trim() || !visitId) return;
    setIsSearching(true);
    setError(null);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery.trim(), visitId, k: 10 }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || tPoc("errorSearch"));
      }

      const data = await res.json();
      setSearchResults(data.matches);
    } catch (err) {
      setError(err instanceof Error ? err.message : tPoc("errorSearch"));
    } finally {
      setIsSearching(false);
    }
  };

  const handleGenerate = async () => {
    if (!visitId) return;
    setIsGenerating(true);
    setError(null);

    try {
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
          ? { ...prev, soap_note: data.generatedNote, patient_letter: data.letter }
          : prev
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : tPoc("errorGenerate"));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveNote = useCallback(async () => {
    if (!visitId || !generatedNoteHtml) return;
    setIsSaving(true);
    setSaveStatus("idle");

    try {
      const res = await fetch(`/api/encounters/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soap_note: generatedNoteHtml }),
      });

      if (!res.ok) throw new Error("Failed to save note");

      setVisit((prev) =>
        prev ? { ...prev, soap_note: generatedNoteHtml } : prev
      );
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save note");
    } finally {
      setIsSaving(false);
    }
  }, [visitId, generatedNoteHtml]);

  const handleMarkComplete = async () => {
    if (!visitId) return;

    try {
      const res = await fetch(`/api/encounters/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      });

      if (!res.ok) throw new Error("Failed to update status");
      setVisit((prev) => (prev ? { ...prev, status: "closed" } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    }
  };

  const handleDelete = async () => {
    if (!visitId) return;
    if (!confirm(t("delete.message"))) return;

    try {
      const res = await fetch(`/api/encounters/${visitId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete visit");
      router.push(getLocalizedHref(""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete visit");
    }
  };

  const isHtmlContent = (content: string) => content.trimStart().startsWith("<");

  const canGenerate = !!(visit?.raw_text || doctorNotes.trim());

  // Loading state
  if (isLoading) {
    return (
      <AppShell>
        <div className="max-w-4xl space-y-6">
          <Skeleton className="h-8 w-64" />
          <Card>
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/5" />
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  // Error state (no visit loaded)
  if (error && !visit) {
    return (
      <AppShell>
        <Alert variant="destructive">
          <HugeiconsIcon icon={AlertCircleIcon} size={16} />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </AppShell>
    );
  }

  if (!visit) return null;

  return (
    <AppShell>
      <div className="max-w-4xl space-y-6">
        {/* Header: Title + Actions */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            <Input
              value={title}
              onChange={(e) => updateTitle(e.target.value)}
              onBlur={handleMetadataBlur}
              placeholder={t("form.titlePlaceholder")}
              className="text-lg font-semibold border-none shadow-none px-0 h-auto focus-visible:ring-0"
            />
            <div className="flex items-center gap-3">
              <Input
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                onBlur={handleMetadataBlur}
                placeholder={t("form.patientNamePlaceholder")}
                className="h-8 max-w-48 text-sm"
              />
              <select
                value={visitType}
                onChange={(e) => {
                  setVisitType(e.target.value as VisitType);
                  // Trigger save on change
                  setTimeout(handleMetadataBlur, 0);
                }}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                {VISIT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`type.${type}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {visit.status === "review" && (
              <Button variant="outline" size="sm" onClick={handleMarkComplete}>
                <HugeiconsIcon icon={Tick01Icon} size={16} />
                {t("status.closed")}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleDelete}>
              <HugeiconsIcon
                icon={Delete01Icon}
                size={16}
                className="text-destructive"
              />
            </Button>
          </div>
        </div>

        {/* Error alert */}
        {error && (
          <Alert variant="destructive">
            <HugeiconsIcon icon={AlertCircleIcon} size={16} />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Audio Section */}
        <AudioSection
          visitId={visitId}
          locale={locale}
          hasTranscript={!!visit.raw_text}
          disabled={isGenerating}
          onTranscriptReady={handleTranscriptReady}
          onError={(msg) => setError(msg || null)}
        />

        {/* Template Selector */}
        <div className="space-y-2">
          <label className="text-sm font-medium">
            {tTemplates("selectTemplate")}
          </label>
          <TemplateSelector
            value={selectedTemplateId}
            onChange={setSelectedTemplateId}
            disabled={isGenerating}
          />
        </div>

        {/* Doctor's Notes + AI Transcript tabs */}
        <Tabs defaultValue="notes">
          <TabsList className="w-full">
            <TabsTrigger value="notes" className="flex-1">
              {tTemplates("doctorNotes")}
            </TabsTrigger>
            <TabsTrigger value="transcript" className="flex-1">
              {t("detail.transcript")}
            </TabsTrigger>
          </TabsList>

          {/* Doctor's Notes tab */}
          <TabsContent value="notes">
            <TiptapEditor
              content={doctorNotes}
              onChange={setDoctorNotes}
              placeholder={tTemplates("doctorNotesPlaceholder")}
              className="min-h-48"
            />
          </TabsContent>

          {/* AI Transcript tab */}
          <TabsContent value="transcript" className="space-y-4">
            {visit.raw_text ? (
              <>
                <Card>
                  <CardContent>
                    <ScrollArea className="h-64">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">
                        {visit.raw_text}
                      </p>
                    </ScrollArea>
                  </CardContent>
                </Card>

                {/* Semantic search */}
                <Card>
                  <CardContent>
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleSearch();
                      }}
                    >
                      <div className="relative flex-1">
                        <Input
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder={t("detail.searchPlaceholder")}
                          disabled={isSearching}
                        />
                      </div>
                      <Button
                        type="submit"
                        disabled={!searchQuery.trim() || isSearching}
                        variant="outline"
                      >
                        {isSearching ? (
                          <HugeiconsIcon
                            icon={Loading03Icon}
                            size={16}
                            className="animate-spin"
                          />
                        ) : (
                          <HugeiconsIcon icon={Search01Icon} size={16} />
                        )}
                        {t("detail.search")}
                      </Button>
                    </form>

                    {searchResults.length > 0 && (
                      <div className="mt-4 space-y-2">
                        {searchResults.map((match) => (
                          <div
                            key={match.id}
                            className="rounded-lg border p-3 text-sm"
                          >
                            <div className="mb-1 flex items-center justify-between">
                              <span className="font-medium text-muted-foreground">
                                {tPoc("chunk")} #{match.chunk_index + 1}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {tPoc("similarity")}:{" "}
                                {(match.similarity * 100).toFixed(1)}%
                              </span>
                            </div>
                            <p className="leading-relaxed">{match.content}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  {t("detail.noTranscript")}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* Generate button */}
        <Button
          onClick={handleGenerate}
          disabled={isGenerating || !canGenerate}
          className="w-full"
        >
          {isGenerating ? (
            <>
              <HugeiconsIcon
                icon={Loading03Icon}
                size={16}
                className="animate-spin"
              />
              {t("detail.generating")}
            </>
          ) : (
            <>
              <HugeiconsIcon icon={MagicWand01Icon} size={16} />
              {t("detail.generate")}
            </>
          )}
        </Button>

        {/* Generation skeleton */}
        {isGenerating && (
          <Card>
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
            </CardContent>
          </Card>
        )}

        {/* Generated Note */}
        {generatedNoteHtml && !isGenerating && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <HugeiconsIcon icon={Note01Icon} size={18} />
                  {t("detail.soapNote")}
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSaveNote}
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <>
                      <HugeiconsIcon
                        icon={Loading03Icon}
                        size={14}
                        className="animate-spin"
                      />
                      {t("detail.saving")}
                    </>
                  ) : saveStatus === "saved" ? (
                    <>
                      <HugeiconsIcon icon={Tick02Icon} size={14} />
                      {t("detail.saved")}
                    </>
                  ) : (
                    <>
                      <HugeiconsIcon icon={FloppyDiskIcon} size={14} />
                      {t("detail.saveNote")}
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isHtmlContent(generatedNoteHtml) ? (
                <TiptapEditor
                  content={generatedNoteHtml}
                  onChange={setGeneratedNoteHtml}
                  className="min-h-64"
                />
              ) : (
                <div className="whitespace-pre-wrap text-sm leading-relaxed">
                  {generatedNoteHtml}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Patient Letter */}
        {visit.patient_letter && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HugeiconsIcon icon={Note01Icon} size={18} />
                {t("detail.patientLetter")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="whitespace-pre-wrap text-sm leading-relaxed">
                {visit.patient_letter}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
