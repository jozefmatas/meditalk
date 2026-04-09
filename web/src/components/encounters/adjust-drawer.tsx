"use client";

import { useState, useRef, useCallback } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
} from "@/components/shared/drawer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shared/dialog";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/shared/tabs";
import { Button } from "@/components/shared/button";
import { Separator } from "@/components/shared/separator";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/shared/select";
import {
  RecordingBar,
  type RecordingBarRef,
} from "@/components/encounters/recording-bar";
import {
  FilesContent,
  hasUploadingFiles,
  type EncounterFile,
} from "@/components/encounters/files-panel";
import { TiptapEditor } from "@/components/editor/tiptap-editor";
import { HugeiconsIcon } from "@hugeicons/react";
import { SparklesIcon, Loading03Icon } from "@hugeicons/core-free-icons";
import type { SupportedLanguage } from "@/lib/types";

const GENERATION_LANGUAGES: { value: SupportedLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "sk", label: "Slovenčina" },
  { value: "cs", label: "Čeština" },
];

interface AdjustDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  visitId: string;
  metadata?: {
    recording_consent?: boolean;
    recording_consent_date?: string;
  };
  files: EncounterFile[];
  onFilesChange: (files: EncounterFile[]) => void;
  generationLanguage: SupportedLanguage;
  onLanguageChange: (lang: SupportedLanguage) => void;
  onAdjustGenerate: (opts: {
    adjustRecordingBarRef: React.RefObject<RecordingBarRef | null>;
    additionalNotes?: string;
  }) => Promise<void>;
  isProcessing: boolean;
  t: (key: string) => string;
}

type RecordingState = "idle" | "recording" | "paused";

export function AdjustDrawer({
  open,
  onOpenChange,
  visitId,
  metadata,
  files,
  onFilesChange,
  generationLanguage,
  onLanguageChange,
  onAdjustGenerate,
  isProcessing,
  t,
}: AdjustDrawerProps) {
  const adjustRecordingBarRef = useRef<RecordingBarRef | null>(null);
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [activeTab, setActiveTab] = useState<"record" | "notes">("record");
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [newFiles, setNewFiles] = useState<EncounterFile[]>([]);

  const handleRegenerate = useCallback(async () => {
    // Merge new files with existing files
    if (newFiles.length > 0) {
      onFilesChange([...files, ...newFiles]);
    }
    onOpenChange(false);
    await onAdjustGenerate({
      adjustRecordingBarRef,
      additionalNotes: additionalNotes.trim() || undefined,
    });
    setAdditionalNotes("");
    setNewFiles([]);
  }, [
    onAdjustGenerate,
    onOpenChange,
    additionalNotes,
    newFiles,
    files,
    onFilesChange,
  ]);

  const handleRecordingComplete = useCallback(() => {
    // Recording blob is handled via finalize() in handleAdjustGenerate
  }, []);

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      // Warn if trying to close while recording
      if (!newOpen && recordingState !== "idle") {
        setConfirmCloseOpen(true);
        return;
      }
      onOpenChange(newOpen);
    },
    [onOpenChange, recordingState],
  );

  const handleConfirmClose = useCallback(() => {
    setConfirmCloseOpen(false);
    setRecordingState("idle"); // Reset state since recording will be lost
    onOpenChange(false);
  }, [onOpenChange]);

  // Enable regenerate when there's new content to process
  const hasContent =
    newFiles.length > 0 ||
    recordingState !== "idle" ||
    additionalNotes.trim().length > 0;

  // Block regenerate while any new file is still uploading so the request
  // doesn't race the uploads and miss their extracted content.
  const newFilesUploading = hasUploadingFiles(newFiles);
  const regenerateDisabled = isProcessing || !hasContent || newFilesUploading;

  return (
    <>
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerContent>
          <div className="mx-auto flex h-full w-full max-w-180 flex-col">
            <DrawerHeader>
              <DrawerTitle className="text-left text-lg font-medium">
                {t("detail.adjustTitle")}
              </DrawerTitle>
              <DrawerDescription className="sr-only">
                {t("detail.adjustTitle")}
              </DrawerDescription>
            </DrawerHeader>

            <div className="flex min-h-80 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-2">
              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as "record" | "notes")}
                className="flex h-full flex-col"
              >
                <TabsList
                  variant="line"
                  className="w-full justify-start border-b [&>button]:flex-none!"
                >
                  <TabsTrigger value="record">
                    {t("detail.adjustTabRecord")}
                  </TabsTrigger>
                  <TabsTrigger value="notes">
                    {t("detail.adjustTabNotes")}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="record" className="mt-4">
                  <div className="flex flex-col gap-4">
                    <div className="[&_div.hidden]:w-full [&_div.hidden]:justify-between">
                      <RecordingBar
                        ref={adjustRecordingBarRef}
                        visitId={visitId}
                        language={generationLanguage}
                        metadata={metadata}
                        onRecordingComplete={handleRecordingComplete}
                        onRecordingStateChange={setRecordingState}
                      />
                    </div>
                    <Separator />
                    <FilesContent
                      visitId={visitId}
                      files={newFiles}
                      onFilesChange={setNewFiles}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="notes" className="mt-4 flex-1">
                  <TiptapEditor
                    content={additionalNotes}
                    onChange={setAdditionalNotes}
                    placeholder={t("detail.adjustNotesPlaceholder")}
                    className="h-full rounded-2xl"
                  />
                </TabsContent>
              </Tabs>
            </div>

            <DrawerFooter>
              {/* Desktop: horizontal layout */}
              <div className="hidden items-center gap-2 desktop:flex">
                <Select
                  value={generationLanguage}
                  onValueChange={(v) =>
                    onLanguageChange(v as SupportedLanguage)
                  }
                  disabled={isProcessing}
                >
                  <SelectTrigger
                    className="w-auto"
                    label={t("detail.noteLanguage")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {GENERATION_LANGUAGES.map((lang) => (
                      <SelectItem key={lang.value} value={lang.value}>
                        {lang.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="lg"
                  onClick={handleRegenerate}
                  disabled={regenerateDisabled}
                  className="flex-1"
                >
                  <HugeiconsIcon
                    icon={isProcessing ? Loading03Icon : SparklesIcon}
                    size={16}
                    className={isProcessing ? "animate-spin" : undefined}
                  />
                  {t("detail.adjustRegenerate")}
                </Button>
              </div>

              {/* Mobile: vertical layout */}
              <div className="flex flex-col gap-2 desktop:hidden">
                <Button
                  size="lg"
                  onClick={handleRegenerate}
                  disabled={regenerateDisabled}
                  className="w-full"
                >
                  <HugeiconsIcon
                    icon={isProcessing ? Loading03Icon : SparklesIcon}
                    size={16}
                    className={isProcessing ? "animate-spin" : undefined}
                  />
                  {t("detail.adjustRegenerate")}
                </Button>
                <Select
                  value={generationLanguage}
                  onValueChange={(v) =>
                    onLanguageChange(v as SupportedLanguage)
                  }
                  disabled={isProcessing}
                >
                  <SelectTrigger
                    className="w-full"
                    label={t("detail.noteLanguage")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GENERATION_LANGUAGES.map((lang) => (
                      <SelectItem key={lang.value} value={lang.value}>
                        {lang.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </DrawerFooter>
          </div>
        </DrawerContent>
      </Drawer>

      {/* Confirmation dialog when trying to close while recording */}
      <Dialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("detail.leaveWhileRecordingTitle")}</DialogTitle>
            <DialogDescription>
              {t("detail.leaveWhileRecordingDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmCloseOpen(false)}
            >
              {t("detail.leaveWhileRecordingStay")}
            </Button>
            <Button variant="destructive" onClick={handleConfirmClose}>
              {t("detail.leaveWhileRecordingLeave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
