"use client";

import { useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Mic01Icon,
  Upload04Icon,
  StopIcon,
  Loading03Icon,
  AlertCircleIcon,
  Tick02Icon,
  ArrowDown01Icon,
} from "@hugeicons/core-free-icons";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";

interface AudioSectionProps {
  visitId: string;
  locale: string;
  hasTranscript: boolean;
  disabled?: boolean;
  onTranscriptReady: (rawText: string) => void;
  onError: (error: string) => void;
}

export function AudioSection({
  visitId,
  locale,
  hasTranscript,
  disabled,
  onTranscriptReady,
  onError,
}: AudioSectionProps) {
  const tPoc = useTranslations("poc");
  const t = useTranslations("visits");

  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState("");
  const [isOpen, setIsOpen] = useState(!hasTranscript);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorder = useAudioRecorder();

  const processAudio = async (audioFile: File) => {
    setIsProcessing(true);
    onError("");

    try {
      setProcessingStatus(tPoc("transcribing"));
      const formData = new FormData();
      formData.append("file", audioFile);
      formData.append("language", locale);
      formData.append("visitId", visitId);

      const res = await fetch("/api/process-audio", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || tPoc("errorUpload"));
      }

      const data = await res.json();
      onTranscriptReady(data.transcriptText);
      setIsOpen(false);
      setFile(null);
      recorder.reset();
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      onError(err instanceof Error ? err.message : tPoc("errorUpload"));
    } finally {
      setIsProcessing(false);
      setProcessingStatus("");
    }
  };

  const handleProcessUpload = () => {
    if (!file) {
      onError(tPoc("errorNoFile"));
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

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const busy = isProcessing || !!disabled;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card>
        <CardContent className="p-0">
          {hasTranscript && !isOpen && (
            <CollapsibleTrigger asChild>
              <button className="flex w-full items-center justify-between px-4 py-3 text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
                <span className="flex items-center gap-2">
                  <HugeiconsIcon icon={Tick02Icon} size={16} className="text-green-600" />
                  {t("detail.audioUploaded")}
                </span>
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  size={16}
                  className="transition-transform"
                />
              </button>
            </CollapsibleTrigger>
          )}

          {!hasTranscript && !isOpen && (
            <CollapsibleTrigger asChild>
              <button className="flex w-full items-center justify-between px-4 py-3 text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
                <span>{t("detail.noAudioYet")}</span>
                <HugeiconsIcon icon={ArrowDown01Icon} size={16} />
              </button>
            </CollapsibleTrigger>
          )}

          <CollapsibleContent>
            <div className="p-4 pt-0">
              {hasTranscript && (
                <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <HugeiconsIcon icon={Tick02Icon} size={16} className="text-green-600" />
                  {t("detail.audioUploaded")}
                  <span className="text-xs">— {t("detail.reprocessAudio")}</span>
                </div>
              )}

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
                  <div className="space-y-3">
                    <Input
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*"
                      disabled={busy}
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
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
                  <div className="space-y-3">
                    {recorder.error && (
                      <Alert variant="destructive">
                        <HugeiconsIcon icon={AlertCircleIcon} size={16} />
                        <AlertDescription>{tPoc("errorRecording")}</AlertDescription>
                      </Alert>
                    )}

                    <div className="flex items-center gap-3">
                      {!recorder.isRecording ? (
                        <Button onClick={recorder.start} disabled={busy} variant="default">
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
                            <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
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

              {/* Processing skeleton */}
              {isProcessing && (
                <div className="mt-4 space-y-2">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                </div>
              )}
            </div>
          </CollapsibleContent>
        </CardContent>
      </Card>
    </Collapsible>
  );
}
