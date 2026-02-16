"use client";

import { useState, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/nav/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Mic01Icon,
  Upload04Icon,
  StopIcon,
  Loading03Icon,
  AlertCircleIcon,
  Add01Icon,
} from "@hugeicons/core-free-icons";
import type { VisitType } from "@/lib/types";

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
  const tPoc = useTranslations("poc");
  const locale = useLocale();
  const router = useRouter();

  // Form state
  const [title, setTitle] = useState("");
  const [patientName, setPatientName] = useState("");
  const [visitType, setVisitType] = useState<VisitType>("consultation");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Audio recorder
  const recorder = useAudioRecorder();

  const getLocalizedHref = (href: string) => {
    const base = locale === "sk" ? "" : `/${locale}`;
    return `${base}${href}`;
  };

  const createVisit = async (audioFile?: File) => {
    setIsProcessing(true);
    setError(null);

    try {
      if (audioFile) {
        // Create visit with audio
        setProcessingStatus(tPoc("transcribing"));
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
          throw new Error(data.error || tPoc("errorUpload"));
        }

        const data = await res.json();

        // Update visit with patient name and visit type
        if (patientName.trim() || visitType !== "consultation") {
          await fetch(`/api/visits/${data.visitId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              patient_name: patientName.trim() || null,
              visit_type: visitType,
            }),
          });
        }

        router.push(getLocalizedHref(`/visits/${data.visitId}`));
      } else {
        // Create visit without audio
        const res = await fetch("/api/visits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim() || null,
            patient_name: patientName.trim() || null,
            visit_type: visitType,
            language: locale,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to create visit");
        }

        const visit = await res.json();
        router.push(getLocalizedHref(`/visits/${visit.id}`));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create visit");
    } finally {
      setIsProcessing(false);
      setProcessingStatus("");
    }
  };

  const handleProcessUpload = () => {
    if (!file) {
      setError(tPoc("errorNoFile"));
      return;
    }
    createVisit(file);
  };

  const handleProcessRecording = () => {
    if (!recorder.audioBlob) return;
    const audioFile = new File([recorder.audioBlob], "recording.webm", {
      type: recorder.audioBlob.type,
    });
    createVisit(audioFile);
  };

  const handleCreateWithoutAudio = () => {
    createVisit();
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const busy = isProcessing;

  return (
    <AppShell>
      <div className="max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">{t("newVisit")}</h1>
        </div>

        {/* Error alert */}
        {error && (
          <Alert variant="destructive" className="mb-4">
            <HugeiconsIcon icon={AlertCircleIcon} size={16} />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Visit details form */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{t("form.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                {t("form.title")}
              </label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("form.titlePlaceholder")}
                disabled={busy}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">
                {t("form.patientName")}
              </label>
              <Input
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder={t("form.patientNamePlaceholder")}
                disabled={busy}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">
                {t("form.visitType")}
              </label>
              <select
                value={visitType}
                onChange={(e) => setVisitType(e.target.value as VisitType)}
                disabled={busy}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {VISIT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`type.${type}`)}
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Audio input */}
        <Card className="mb-6">
          <CardContent>
            <Tabs defaultValue="upload">
              <TabsList className="mb-4 w-full">
                <TabsTrigger value="upload" className="flex-1">
                  <HugeiconsIcon icon={Upload04Icon} size={16} />
                  {tPoc("tabUpload")}
                </TabsTrigger>
                <TabsTrigger value="record" className="flex-1">
                  <HugeiconsIcon icon={Mic01Icon} size={16} />
                  {tPoc("tabRecord")}
                </TabsTrigger>
              </TabsList>

              {/* Upload tab */}
              <TabsContent value="upload">
                <div className="space-y-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">
                      {tPoc("fileLabel")}
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
                        {processingStatus || tPoc("processing")}
                      </>
                    ) : (
                      <>
                        <HugeiconsIcon icon={Upload04Icon} size={16} />
                        {tPoc("process")}
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
                      <AlertDescription>{tPoc("errorRecording")}</AlertDescription>
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
                        {tPoc("recordStart")}
                      </Button>
                    ) : (
                      <Button onClick={recorder.stop} variant="destructive">
                        <HugeiconsIcon icon={StopIcon} size={16} />
                        {tPoc("recordStop")}
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
                    <audio src={recorder.audioUrl} controls className="w-full" />
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
                        {processingStatus || tPoc("processing")}
                      </>
                    ) : (
                      <>
                        <HugeiconsIcon icon={Mic01Icon} size={16} />
                        {tPoc("processRecording")}
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

        {/* Create without audio */}
        <div className="text-center">
          <Button
            variant="outline"
            onClick={handleCreateWithoutAudio}
            disabled={busy}
          >
            <HugeiconsIcon icon={Add01Icon} size={16} />
            {t("form.createVisit")} (without audio)
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
