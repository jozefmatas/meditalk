"use client";

import { useState, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Mic01Icon,
  Upload04Icon,
  Search01Icon,
  StopIcon,
  Loading03Icon,
  CheckmarkCircle01Icon,
  AlertCircleIcon,
  Logout01Icon,
  MagicWand01Icon,
  Note01Icon,
} from "@hugeicons/core-free-icons";
import type { ChunkMatch } from "@/lib/types";

export default function Home() {
  const t = useTranslations("poc");
  const tAuth = useTranslations("auth");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  // Form state
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState("");
  const [transcriptId, setTranscriptId] = useState<string | null>(null);
  const [transcriptText, setTranscriptText] = useState<string | null>(null);
  const [chunkCount, setChunkCount] = useState(0);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<ChunkMatch[]>([]);

  // Generate state
  const [isGenerating, setIsGenerating] = useState(false);
  const [soapNote, setSoapNote] = useState<string | null>(null);
  const [patientLetter, setPatientLetter] = useState<string | null>(null);

  // Error state
  const [error, setError] = useState<string | null>(null);

  // --- PREVIEW MODE: remove this block to disable mock data ---
  const PREVIEW = false;
  if (PREVIEW && !transcriptText) {
    const mockText =
      "Patient reports persistent headache for the past 3 days, predominantly in the frontal region. Pain intensity rated 6/10. No visual disturbances or nausea. Patient has been taking ibuprofen 400mg with partial relief. Blood pressure measured at 130/85 mmHg. No neurological deficits observed. Assessment: Tension-type headache, likely stress-related. Plan: Continue ibuprofen as needed, recommend stress management techniques, follow-up in 2 weeks if symptoms persist.";
    const mockSearch: ChunkMatch[] = [
      {
        id: "1",
        transcript_id: "t1",
        chunk_index: 0,
        content:
          "Patient reports persistent headache for the past 3 days, predominantly in the frontal region. Pain intensity rated 6/10.",
        similarity: 0.92,
      },
      {
        id: "2",
        transcript_id: "t1",
        chunk_index: 1,
        content:
          "Blood pressure measured at 130/85 mmHg. No neurological deficits observed.",
        similarity: 0.78,
      },
    ];
    const mockSoap =
      "S (Subjective):\nPatient reports persistent headache for 3 days, frontal region, 6/10 intensity. No visual disturbances or nausea. Partial relief with ibuprofen 400mg.\n\nO (Objective):\nBP 130/85 mmHg. No neurological deficits.\n\nA (Assessment):\nTension-type headache, likely stress-related.\n\nP (Plan):\nContinue ibuprofen PRN. Stress management techniques recommended. Follow-up in 2 weeks if symptoms persist.";
    const mockLetter =
      "Dear Patient,\n\nThank you for visiting today. You came in with a headache that has been present for 3 days, mainly in the front of your head. Your blood pressure was slightly elevated at 130/85, and your neurological examination was normal.\n\nBased on our assessment, this appears to be a tension-type headache, likely related to stress. You may continue taking ibuprofen as needed for pain relief.\n\nWe recommend incorporating stress management techniques into your routine. If your symptoms do not improve within 2 weeks, please schedule a follow-up appointment.\n\nBest regards,\nYour Medical Team";

    // Defer state updates to avoid setting state during render
    setTimeout(() => {
      setTranscriptId("preview-id");
      setTranscriptText(mockText);
      setChunkCount(3);
      setSearchResults(mockSearch);
      setSoapNote(mockSoap);
      setPatientLetter(mockLetter);
    }, 0);
  }
  // --- END PREVIEW MODE ---

  // Audio recorder
  const recorder = useAudioRecorder();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh();
  };

  const processAudio = async (audioFile: File) => {
    setIsProcessing(true);
    setError(null);
    setTranscriptId(null);
    setTranscriptText(null);
    setChunkCount(0);
    setSearchResults([]);
    setSoapNote(null);
    setPatientLetter(null);

    try {
      setProcessingStatus(t("transcribing"));
      const formData = new FormData();
      formData.append("file", audioFile);
      formData.append("language", locale);
      if (title.trim()) formData.append("title", title.trim());

      const res = await fetch("/api/process-audio", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t("errorUpload"));
      }

      const data = await res.json();
      setTranscriptId(data.transcriptId);
      setTranscriptText(data.transcriptText);
      setChunkCount(data.chunkCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorUpload"));
    } finally {
      setIsProcessing(false);
      setProcessingStatus("");
    }
  };

  const handleProcessUpload = () => {
    if (!file) {
      setError(t("errorNoFile"));
      return;
    }
    processAudio(file);
  };

  const handleProcessRecording = () => {
    if (!recorder.audioBlob) return;
    const audioFile = new File([recorder.audioBlob], "recording.webm", {
      type: recorder.audioBlob.type,
    });
    processAudio(audioFile);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim() || !transcriptId) return;
    setIsSearching(true);
    setError(null);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: searchQuery.trim(),
          transcriptId,
          k: 10,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t("errorSearch"));
      }

      const data = await res.json();
      setSearchResults(data.matches);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorSearch"));
    } finally {
      setIsSearching(false);
    }
  };

  const handleGenerate = async () => {
    if (!transcriptId) return;
    setIsGenerating(true);
    setError(null);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcriptId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t("errorGenerate"));
      }

      const data = await res.json();
      setSoapNote(data.soap);
      setPatientLetter(data.letter);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorGenerate"));
    } finally {
      setIsGenerating(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const busy = isProcessing || isGenerating;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {tCommon("appName")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("description")}</p>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Button variant="outline" size="default" onClick={handleSignOut}>
              <HugeiconsIcon icon={Logout01Icon} size={16} />
              {tAuth("signOut")}
            </Button>
          </div>
        </div>

        {/* Error alert */}
        {error && (
          <Alert variant="destructive" className="mb-4">
            <HugeiconsIcon icon={AlertCircleIcon} size={16} />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Input card with tabs */}
        <Card className="mb-6">
          <CardContent>
            <Tabs defaultValue="upload">
              <TabsList className="mb-4 w-full">
                <TabsTrigger value="upload" className="flex-1">
                  <HugeiconsIcon icon={Upload04Icon} size={16} />
                  {t("tabUpload")}
                </TabsTrigger>
                <TabsTrigger value="record" className="flex-1">
                  <HugeiconsIcon icon={Mic01Icon} size={16} />
                  {t("tabRecord")}
                </TabsTrigger>
              </TabsList>

              {/* Title input (shared) */}
              <div className="mb-4">
                <label className="mb-1.5 block text-sm font-medium">
                  {t("titleLabel")}
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("titlePlaceholder")}
                  disabled={busy}
                />
              </div>

              {/* Upload tab */}
              <TabsContent value="upload">
                <div className="space-y-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">
                      {t("fileLabel")}
                    </label>
                    <Input
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*"
                      disabled={busy}
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                  <Button
                    onClick={handleProcessUpload}
                    disabled={!file || busy}
                    className="w-full"
                  >
                    {isProcessing ? (
                      <>
                        <HugeiconsIcon
                          icon={Loading03Icon}
                          size={16}
                          className="animate-spin"
                        />
                        {processingStatus || t("processing")}
                      </>
                    ) : (
                      <>
                        <HugeiconsIcon icon={Upload04Icon} size={16} />
                        {t("process")}
                      </>
                    )}
                  </Button>
                </div>
              </TabsContent>

              {/* Record tab */}
              <TabsContent value="record">
                <div className="space-y-4">
                  {recorder.error && (
                    <Alert variant="destructive">
                      <HugeiconsIcon icon={AlertCircleIcon} size={16} />
                      <AlertDescription>{t("errorRecording")}</AlertDescription>
                    </Alert>
                  )}

                  <div className="flex items-center gap-3">
                    {!recorder.isRecording ? (
                      <Button
                        onClick={recorder.start}
                        disabled={busy}
                        variant="default"
                      >
                        <HugeiconsIcon icon={Mic01Icon} size={16} />
                        {t("recordStart")}
                      </Button>
                    ) : (
                      <Button onClick={recorder.stop} variant="destructive">
                        <HugeiconsIcon icon={StopIcon} size={16} />
                        {t("recordStop")}
                      </Button>
                    )}

                    {(recorder.isRecording || recorder.duration > 0) && (
                      <span className="tabular-nums text-sm text-muted-foreground">
                        {recorder.isRecording && (
                          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                        )}
                        {formatDuration(recorder.duration)}
                      </span>
                    )}
                  </div>

                  {recorder.audioUrl && (
                    <audio
                      src={recorder.audioUrl}
                      controls
                      className="w-full"
                    />
                  )}

                  <Button
                    onClick={handleProcessRecording}
                    disabled={!recorder.audioBlob || busy}
                    className="w-full"
                  >
                    {isProcessing ? (
                      <>
                        <HugeiconsIcon
                          icon={Loading03Icon}
                          size={16}
                          className="animate-spin"
                        />
                        {processingStatus || t("processing")}
                      </>
                    ) : (
                      <>
                        <HugeiconsIcon icon={Mic01Icon} size={16} />
                        {t("processRecording")}
                      </>
                    )}
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Processing skeleton */}
        {isProcessing && (
          <Card className="mb-6">
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </CardContent>
          </Card>
        )}

        {/* Results area */}
        {transcriptText && (
          <div className="space-y-6">
            {/* Success indicator */}
            <Alert>
              <HugeiconsIcon icon={CheckmarkCircle01Icon} size={16} />
              <AlertDescription>
                {t("successProcess")} — {chunkCount} {t("chunks")}
              </AlertDescription>
            </Alert>

            {/* Transcript viewer */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HugeiconsIcon icon={Note01Icon} size={18} />
                  {t("transcript")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-64">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {transcriptText}
                  </p>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Search */}
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
                      placeholder={t("searchPlaceholder")}
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
                    {t("searchButton")}
                  </Button>
                </form>

                {/* Search results */}
                {searchResults.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {searchResults.map((match) => (
                      <div
                        key={match.id}
                        className="rounded-lg border p-3 text-sm"
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span className="font-medium text-muted-foreground">
                            {t("chunk")} #{match.chunk_index + 1}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t("similarity")}:{" "}
                            {(match.similarity * 100).toFixed(1)}%
                          </span>
                        </div>
                        <p className="leading-relaxed">{match.content}</p>
                      </div>
                    ))}
                  </div>
                )}

                {searchResults.length === 0 && searchQuery && !isSearching && (
                  <p className="mt-3 text-center text-sm text-muted-foreground">
                    {t("noResults")}
                  </p>
                )}
              </CardContent>
            </Card>

            <Separator />

            {/* Generate SOAP + Letter */}
            <div className="space-y-4">
              <Button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="w-full"
                size="default"
              >
                {isGenerating ? (
                  <>
                    <HugeiconsIcon
                      icon={Loading03Icon}
                      size={16}
                      className="animate-spin"
                    />
                    {t("generating")}
                  </>
                ) : (
                  <>
                    <HugeiconsIcon icon={MagicWand01Icon} size={16} />
                    {t("generateButton")}
                  </>
                )}
              </Button>

              {/* Generation skeleton */}
              {isGenerating && (
                <div className="space-y-4">
                  <Card>
                    <CardContent className="space-y-3">
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-4/5" />
                      <Skeleton className="h-4 w-3/4" />
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="space-y-3">
                      <Skeleton className="h-4 w-1/3" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-5/6" />
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* SOAP note */}
              {soapNote && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <HugeiconsIcon icon={Note01Icon} size={18} />
                      {t("soapNote")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="max-h-96">
                      <div className="whitespace-pre-wrap text-sm leading-relaxed">
                        {soapNote}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}

              {/* Patient letter */}
              {patientLetter && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <HugeiconsIcon icon={Note01Icon} size={18} />
                      {t("patientLetter")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">
                      {patientLetter}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
