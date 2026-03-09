"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useLocalizedHref } from "@/hooks/use-localized-href";
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
  FloppyDiskIcon,
  Tick02Icon,
  ArrowLeft01Icon,
} from "@hugeicons/core-free-icons";
import { TiptapEditor } from "@/components/editor/tiptap-editor";
import { TemplateSelector } from "@/components/templates/template-selector";
import { AudioSection } from "@/components/visits/audio-section";
import { getDefaultTemplate } from "@/lib/templates";
import type { VisitType, ChunkMatch } from "@/lib/types";

const VISIT_TYPES: VisitType[] = [
  "consultation",
  "follow_up",
  "preventive",
  "acute",
  "specialist_referral",
  "telemedicine",
  "home_visit",
];

export default function NewVisitPage() {
  const t = useTranslations("visits");
  const tTemplates = useTranslations("templates");
  const tPoc = useTranslations("poc");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateParam = searchParams.get("template");
  const getHref = useLocalizedHref();

  // Visit creation state
  const [visitId, setVisitId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Metadata
  const [title, setTitle] = useState("");
  const [patientName, setPatientName] = useState("");
  const [visitType, setVisitType] = useState<VisitType>("consultation");

  // Transcript
  const [rawText, setRawText] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<ChunkMatch[]>([]);

  // Template + generation state
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    templateParam || getDefaultTemplate().id
  );
  const [doctorNotes, setDoctorNotes] = useState("");
  const [generatedNoteHtml, setGeneratedNoteHtml] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");

  const [error, setError] = useState<string | null>(null);

  // Auto-create visit on mount (so audio can be attached immediately)
  useEffect(() => {
    if (visitId) return;

    const createVisit = async () => {
      setIsCreating(true);
      try {
        const res = await fetch("/api/visits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            language: locale,
            ...(templateParam ? { metadata: { template_id: templateParam } } : {}),
          }),
        });

        if (!res.ok) throw new Error("Failed to create visit");

        const visit = await res.json();
        setVisitId(visit.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create visit");
      } finally {
        setIsCreating(false);
      }
    };

    createVisit();
  }, [visitId, locale, templateParam]);

  // Save metadata on blur
  const handleMetadataBlur = useCallback(async () => {
    if (!visitId) return;

    try {
      await fetch(`/api/visits/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || null,
          patient_name: patientName.trim() || null,
          visit_type: visitType,
        }),
      });
    } catch {
      // Silent fail
    }
  }, [visitId, title, patientName, visitType]);

  // Auto-save doctor notes (2s debounce)
  const initialDoctorNotesRef = useRef("");
  useEffect(() => {
    if (!visitId || doctorNotes === initialDoctorNotesRef.current) return;

    const timeout = setTimeout(async () => {
      try {
        await fetch(`/api/visits/${visitId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            metadata: { doctor_notes: doctorNotes, template_id: selectedTemplateId },
          }),
        });
        initialDoctorNotesRef.current = doctorNotes;
      } catch {
        // Silent fail
      }
    }, 2000);

    return () => clearTimeout(timeout);
  }, [doctorNotes, visitId, selectedTemplateId]);

  const handleTranscriptReady = (text: string) => {
    setRawText(text);
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
      const res = await fetch(`/api/visits/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soap_note: generatedNoteHtml }),
      });

      if (!res.ok) throw new Error("Failed to save note");

      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save note");
    } finally {
      setIsSaving(false);
    }
  }, [visitId, generatedNoteHtml]);

  const isHtmlContent = (content: string) => content.trimStart().startsWith("<");
  const canGenerate = !!(rawText || doctorNotes.trim());
  const busy = isCreating || isGenerating;

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <div className="border-b">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href={getHref("")}>
              <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
            </Link>
          </Button>
          <h1 className="text-lg font-semibold">{t("newVisit")}</h1>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        {/* Error alert */}
        {error && (
          <Alert variant="destructive">
            <HugeiconsIcon icon={AlertCircleIcon} size={16} />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Visit metadata */}
        <div className="space-y-3">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleMetadataBlur}
            placeholder={t("form.titlePlaceholder")}
            disabled={busy}
            className="text-lg font-semibold border-none shadow-none px-0 h-auto focus-visible:ring-0"
          />
          <div className="flex items-center gap-3">
            <Input
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              onBlur={handleMetadataBlur}
              placeholder={t("form.patientNamePlaceholder")}
              disabled={busy}
              className="h-8 max-w-48 text-sm"
            />
            <select
              value={visitType}
              onChange={(e) => {
                setVisitType(e.target.value as VisitType);
                setTimeout(handleMetadataBlur, 0);
              }}
              disabled={busy}
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

        {/* Audio Section */}
        {visitId ? (
          <AudioSection
            visitId={visitId}
            locale={locale}
            hasTranscript={!!rawText}
            disabled={busy}
            onTranscriptReady={handleTranscriptReady}
            onError={(msg) => setError(msg || null)}
          />
        ) : (
          <Card>
            <CardContent className="py-6">
              <Skeleton className="mx-auto h-4 w-48" />
            </CardContent>
          </Card>
        )}

        {/* Template Selector */}
        <div className="space-y-2">
          <label className="text-sm font-medium">
            {tTemplates("selectTemplate")}
          </label>
          <TemplateSelector
            value={selectedTemplateId}
            onChange={setSelectedTemplateId}
            disabled={busy}
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
            {rawText ? (
              <>
                <Card>
                  <CardContent>
                    <ScrollArea className="h-64">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">
                        {rawText}
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
          disabled={isGenerating || !canGenerate || !visitId}
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
      </div>
    </div>
  );
}
