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
import { logger } from "@/lib/logger";

export interface EncounterFile extends FileMetadata {
  /** True if file is saved to IndexedDB but upload pending */
  pending?: boolean;
  /** True if recording is actively in progress (stops spinner when paused) */
  isRecording?: boolean;
}

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
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const allFiles = Array.from(fileList);
      if (allFiles.length === 0) return;

      setIsUploading(true);
      const { uploadWithRetry } =
        await import("@/lib/upload/upload-with-persistence");

      // Add pending files to list immediately (before upload)
      const pendingFiles: EncounterFile[] = allFiles.map((file) => ({
        id: crypto.randomUUID(), // temporary ID
        name: file.name,
        size: file.size,
        type: file.type,
        pending: true,
        // Tag audio files uploaded during recording so they can use real-time transcript
        source:
          hasActiveRecording && file.type.startsWith("audio/")
            ? "recording-upload"
            : undefined,
      }));
      onFilesChange([...files, ...pendingFiles]);

      try {
        // Upload all files with retry
        const results = await Promise.allSettled(
          allFiles.map(async (file) => {
            // Tag audio files uploaded during recording so they can use real-time transcript
            const source =
              hasActiveRecording && file.type.startsWith("audio/")
                ? "recording-upload"
                : undefined;
            return uploadWithRetry(file, file.name, visitId, {
              source,
            });
          }),
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

        // Trigger immediate extraction for each uploaded file (background, fire-and-forget)
        // This saves 15-50s per file during generation by pre-caching extracted text
        // NOTE: Always extract audio files even if recording is active — generate will
        // prefer real-time transcript if available, but fall back to extracted text
        const uploadedFiles = data.files as EncounterFile[];
        uploadedFiles.forEach((file) => {
          // Extract in background (don't await, don't block UI)
          fetch(`/api/encounters/${visitId}/extract`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileId: file.id }),
          })
            .then((extractRes) => {
              if (extractRes.ok) {
                logger.debug(`[extract] Started extraction for ${file.name}`);
              }
            })
            .catch((extractErr) => {
              logger.warn(
                `[extract] Failed to trigger extraction for ${file.name}:`,
                extractErr,
              );
            });
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

  return (
    <>
      {/* Upload dropzone */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
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

      {/* File list */}
      {files.length > 0 && (
        <div className="flex flex-col">
          <span className="text-xs text-foreground/65">
            {t("uploadedFiles")}
          </span>
          <Table variant="compact">
            <TableBody>
              {files.map((file) => (
                <TableRow key={file.id} className="group border-border">
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
                            (file.source !== "recording" || file.isRecording) &&
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
                          onClick={() => handleDelete(file.id)}
                        >
                          <HugeiconsIcon icon={Delete01Icon} size={12} />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
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
