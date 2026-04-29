"use client";

import { useState, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DragLeft01Icon,
  Delete01Icon,
  Loading03Icon,
  File01Icon,
  Mic01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/shared/button";
import {
  Table,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/shared/table";
import { cn } from "@/lib/utils";
import type { FileMetadata } from "@/lib/types";
import { emit } from "@/lib/events";
import { logger } from "@/lib/logger";
import { isAndroid } from "@/lib/platform";
import {
  type EncounterFile,
  pendingContextSaves,
} from "@/lib/encounters/file-state";
import { FileContextDialog } from "./file-context-dialog";
import { FilePickerDrawer } from "./file-picker-drawer";

interface FilesContentProps {
  visitId: string;
  files: EncounterFile[];
  onFilesChange: (
    files: EncounterFile[] | ((prev: EncounterFile[]) => EncounterFile[]),
  ) => void;
  /** True if audio recording is currently active */
  hasActiveRecording?: boolean;
}

type FilesPanelProps = FilesContentProps;

function iconForType(type: string) {
  return type.startsWith("audio/") ? Mic01Icon : File01Icon;
}

export function FilesContent({
  visitId,
  files,
  onFilesChange,
  hasActiveRecording = false,
}: FilesContentProps) {
  const t = useTranslations("encounters.detail");
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [contextDialogOpen, setContextDialogOpen] = useState(false);
  const [pickerDrawerOpen, setPickerDrawerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const allFiles = Array.from(fileList);
      if (allFiles.length === 0) return;

      setIsUploading(true);
      const { uploadWithRetry } =
        await import("@/lib/upload/upload-with-persistence");

      // Compute source tags once — audio files uploaded during an active
      // recording get tagged so the server can use the real-time transcript
      const fileSources = allFiles.map((file) =>
        hasActiveRecording && file.type.startsWith("audio/")
          ? ("recording-upload" as const)
          : undefined,
      );

      // Add pending files to list immediately (before upload)
      const pendingFiles: EncounterFile[] = allFiles.map((file, i) => ({
        id: crypto.randomUUID(), // temporary ID
        name: file.name,
        size: file.size,
        type: file.type,
        pending: true,
        source: fileSources[i],
      }));
      onFilesChange([...files, ...pendingFiles]);

      try {
        // Upload all files with retry
        const results = await Promise.allSettled(
          allFiles.map(async (file, i) =>
            uploadWithRetry(file, file.name, visitId, {
              source: fileSources[i],
            }),
          ),
        );

        const uploadResults = results
          .filter((r) => r.status === "fulfilled")
          .map(
            (r) =>
              (
                r as PromiseFulfilledResult<
                  Awaited<ReturnType<typeof uploadWithRetry>>
                >
              ).value,
          );

        if (uploadResults.length === 0) {
          // All uploads failed — remove pending files so spinners stop
          onFilesChange((prevFiles) => {
            const pendingIds = new Set(pendingFiles.map((f) => f.id));
            return prevFiles.filter((f) => !pendingIds.has(f.id));
          });
          return;
        }

        // Register file metadata with the API
        const res = await fetch(`/api/encounters/${visitId}/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: uploadResults }),
        });

        if (!res.ok) {
          throw new Error(`Metadata registration failed: ${res.status}`);
        }

        const data = await res.json();

        // Replace only the pending files that were just uploaded (preserve recording file)
        onFilesChange((prevFiles) => {
          const uploadedIds = new Set(pendingFiles.map((f) => f.id));
          const withoutTheseUploads = prevFiles.filter(
            (f) => !uploadedIds.has(f.id),
          );
          return [...withoutTheseUploads, ...(data.files as EncounterFile[])];
        });

        // Open context dialog if any uploaded files are non-audio
        const uploadedFiles = data.files as EncounterFile[];
        const hasNonAudioUploads = uploadedFiles.some(
          (f) =>
            !f.type.startsWith("audio/") &&
            f.source !== "recording" &&
            f.source !== "recording-upload",
        );
        if (hasNonAudioUploads) {
          setContextDialogOpen(true);
        }

        // Trigger immediate extraction for each uploaded file (background).
        // Track completion so we can update file state and notify other components.
        // Includes a single retry (2s delay) for transient failures.
        uploadedFiles.forEach((file) => {
          const tryExtract = async (attempt: number): Promise<void> => {
            try {
              const extractRes = await fetch(
                `/api/encounters/${visitId}/extract`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ fileId: file.id }),
                },
              );

              if (extractRes.ok) {
                const result = await extractRes.json();
                logger.debug(`[extract] Completed extraction for ${file.name}`);
                onFilesChange((prev) =>
                  prev.map((f) =>
                    f.id === file.id
                      ? {
                          ...f,
                          extraction_status: "completed" as const,
                          extracted_text: result.text ?? f.extracted_text,
                        }
                      : f,
                  ),
                );
                emit("extraction-complete", { visitId, fileId: file.id });
              } else if (attempt === 0) {
                logger.warn(
                  `[extract] Extraction failed for ${file.name}: ${extractRes.status}, retrying...`,
                );
                await new Promise((r) => setTimeout(r, 2000));
                return tryExtract(1);
              } else {
                logger.warn(
                  `[extract] Extraction failed for ${file.name} after retry: ${extractRes.status}`,
                );
                onFilesChange((prev) =>
                  prev.map((f) =>
                    f.id === file.id
                      ? { ...f, extraction_status: "failed" as const }
                      : f,
                  ),
                );
              }
            } catch (extractErr) {
              if (attempt === 0) {
                logger.warn(
                  `[extract] Extraction error for ${file.name}, retrying...`,
                  extractErr,
                );
                await new Promise((r) => setTimeout(r, 2000));
                return tryExtract(1);
              }
              logger.warn(
                `[extract] Extraction failed for ${file.name} after retry:`,
                extractErr,
              );
              onFilesChange((prev) =>
                prev.map((f) =>
                  f.id === file.id
                    ? { ...f, extraction_status: "failed" as const }
                    : f,
                ),
              );
            }
          };

          tryExtract(0);
        });
      } catch (err) {
        logger.error("File upload error:", err);
        // Remove pending files so spinners stop
        onFilesChange((prevFiles) => {
          const pendingIds = new Set(pendingFiles.map((f) => f.id));
          return prevFiles.filter((f) => !pendingIds.has(f.id));
        });
      } finally {
        setIsUploading(false);
      }
    },
    [visitId, files, onFilesChange, hasActiveRecording],
  );

  const handleDelete = useCallback(
    async (fileId: string) => {
      try {
        const res = await fetch(
          `/api/encounters/${visitId}/files?fileId=${fileId}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          logger.error("File delete failed:", res.status);
          return;
        }
        onFilesChange(files.filter((f) => f.id !== fileId));
      } catch (err) {
        logger.error("File delete error:", err);
      }
    },
    [visitId, files, onFilesChange],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        uploadFiles(e.dataTransfer.files);
      }
    },
    [uploadFiles],
  );

  const handleContextSave = useCallback(
    (contexts: Record<string, string>) => {
      // Optimistic UI update using the client's current view.
      const updatedFiles = files.map((f) =>
        f.id in contexts ? { ...f, context: contexts[f.id] || null } : f,
      );
      onFilesChange(updatedFiles);

      // Persist by re-reading the server's CURRENT metadata and merging
      // only the changed `context` field. Extraction may have completed
      // between the dialog opening and Save — PATCH-ing with the client's
      // stale files array would clobber the freshly-written
      // `extracted_text` + `extraction_status`. Fetching-then-merging
      // keeps extraction progress intact. Tracked so handleGenerate can
      // await it.
      const savePromise: Promise<void> = (async () => {
        try {
          const res = await fetch(`/api/encounters/${visitId}`);
          if (!res.ok) throw new Error(`fetch visit ${res.status}`);
          const payload = (await res.json()) as {
            metadata?: { files?: FileMetadata[] };
          };
          const serverFiles = payload.metadata?.files ?? [];
          const merged = serverFiles.map((f) =>
            f.id in contexts ? { ...f, context: contexts[f.id] || null } : f,
          );
          const saveRes = await fetch(`/api/encounters/${visitId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ metadata: { files: merged } }),
          });
          if (!saveRes.ok) throw new Error(`patch ${saveRes.status}`);
        } catch (err) {
          logger.error("Failed to persist file contexts:", err);
        } finally {
          pendingContextSaves.delete(visitId);
        }
      })();
      pendingContextSaves.set(visitId, savePromise);
    },
    [files, onFilesChange, visitId],
  );

  return (
    <>
      {/* Upload dropzone */}
      <button
        type="button"
        onClick={() => {
          if (isAndroid) {
            setPickerDrawerOpen(true);
            return;
          }
          inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        disabled={isUploading}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-xl bg-accent p-5 transition-colors",
          isDragging && "ring-2 ring-primary/50",
          !isUploading && "hover:bg-muted/80 cursor-pointer",
        )}
      >
        {isUploading ? (
          <HugeiconsIcon
            icon={Loading03Icon}
            size={20}
            className="size-5 shrink-0 animate-spin text-foreground/65"
          />
        ) : (
          <HugeiconsIcon
            icon={DragLeft01Icon}
            size={20}
            className="size-5 shrink-0 text-foreground/65"
          />
        )}
        <span className="text-xs text-foreground/65 text-balance">
          {t("uploadFiles")}
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.png,.jpg,.jpeg,.mp3,.m4a,.mp4,.wav,.aac,.ogg,.webm,.caf,audio/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) uploadFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <FileContextDialog
        open={contextDialogOpen}
        onOpenChange={setContextDialogOpen}
        files={files}
        onSave={handleContextSave}
      />

      {isAndroid && (
        <FilePickerDrawer
          open={pickerDrawerOpen}
          onOpenChange={setPickerDrawerOpen}
          onTakePhoto={async () => {
            setPickerDrawerOpen(false);
            const { takePhoto } = await import("@/lib/android-file-picker");
            const files = await takePhoto();
            if (files.length > 0) uploadFiles(files);
          }}
          onChooseFromGallery={async () => {
            setPickerDrawerOpen(false);
            const { pickFromGallery } =
              await import("@/lib/android-file-picker");
            const files = await pickFromGallery();
            if (files.length > 0) uploadFiles(files);
          }}
          onFileManager={async () => {
            setPickerDrawerOpen(false);
            const { StoragePermission } =
              await import("@/lib/storage-permission");
            const { granted } = await StoragePermission.request();
            if (!granted) return;
            inputRef.current?.click();
          }}
        />
      )}

      {/* File list */}
      {files.length > 0 && (
        <div className="flex flex-col">
          <span className="text-xs text-foreground/65">
            {t("uploadedFiles")}
          </span>
          <Table variant="compact">
            <TableBody>
              {files.map((file) => {
                const isEligibleForContext =
                  !file.pending &&
                  !file.type.startsWith("audio/") &&
                  file.source !== "recording" &&
                  file.source !== "recording-upload";
                return (
                  <TableRow
                    key={file.id}
                    className={cn(
                      "group border-border",
                      isEligibleForContext && "cursor-pointer",
                    )}
                    onClick={
                      isEligibleForContext
                        ? () => setContextDialogOpen(true)
                        : undefined
                    }
                  >
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-1">
                        <HugeiconsIcon
                          icon={
                            file.pending
                              ? file.source === "recording" && !file.isRecording
                                ? Mic01Icon
                                : Loading03Icon
                              : iconForType(file.type)
                          }
                          size={14}
                          className={cn(
                            "shrink-0 text-muted-foreground",
                            file.pending &&
                              (file.source !== "recording" ||
                                file.isRecording) &&
                              "animate-spin",
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {file.name}
                        </span>
                        {!file.pending && (
                          <Button
                            variant="outline"
                            size="icon-sm"
                            className="shrink-0 desktop:opacity-0 desktop:transition-opacity desktop:group-hover:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(file.id);
                            }}
                          >
                            <HugeiconsIcon icon={Delete01Icon} size={12} />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

export function FilesPanel({
  visitId,
  files,
  onFilesChange,
  hasActiveRecording = false,
}: FilesPanelProps) {
  const t = useTranslations("encounters.detail");

  return (
    <div className="hidden desktop:flex w-72 shrink-0 flex-col gap-4 border-l bg-background p-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-medium leading-none">{t("files")}</h3>
        <p className="text-sm leading-snug text-foreground/65">
          {t("filesDescription")}
        </p>
      </div>
      <FilesContent
        visitId={visitId}
        files={files}
        onFilesChange={onFilesChange}
        hasActiveRecording={hasActiveRecording}
      />
    </div>
  );
}
