"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import type { EncounterFile } from "@/lib/encounters/file-state";
import { emit } from "@/lib/events";
import { logger } from "@/lib/logger";

/** Extraction retry config. Object so tests can override the value. */
export const extractConfig = { retryDelayMs: 2000 };

interface UseFileUploadParams {
  visitId: string;
  onFilesChange: (
    files: EncounterFile[] | ((prev: EncounterFile[]) => EncounterFile[]),
  ) => void;
  hasActiveRecording: boolean;
  /** Called once per upload batch that includes a non-audio file. */
  onShouldPromptContext?: () => void;
}

interface UseFileUploadReturn {
  uploadFiles: (files: File[]) => Promise<void>;
  isUploading: boolean;
}

export function useFileUpload({
  visitId,
  onFilesChange,
  hasActiveRecording,
  onShouldPromptContext,
}: UseFileUploadParams): UseFileUploadReturn {
  const [isUploading, setIsUploading] = useState(false);

  // Keep the latest callback in a ref so uploadFiles stays stable without
  // re-running whenever the caller passes a new function identity.
  const onShouldPromptContextRef = useRef(onShouldPromptContext);
  useEffect(() => {
    onShouldPromptContextRef.current = onShouldPromptContext;
  });

  const uploadFiles = useCallback(
    async (fileList: File[]) => {
      if (fileList.length === 0) return;

      setIsUploading(true);
      const { uploadWithRetry } = await import(
        "@/lib/upload/upload-with-persistence"
      );

      // Tag audio files uploaded during active recording
      const fileSources = fileList.map((file) =>
        hasActiveRecording && file.type.startsWith("audio/")
          ? ("recording-upload" as const)
          : undefined,
      );

      // Add pending files immediately
      const pendingFiles: EncounterFile[] = fileList.map((file, i) => ({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        type: file.type,
        pending: true,
        source: fileSources[i],
      }));
      onFilesChange((prev) => [...prev, ...pendingFiles]);

      try {
        // Upload all files with retry
        const results = await Promise.allSettled(
          fileList.map((file, i) =>
            uploadWithRetry(file, file.name, visitId, {
              source: fileSources[i],
            }),
          ),
        );

        const uploadResults = results
          .filter(
            (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof uploadWithRetry>>> =>
              r.status === "fulfilled",
          )
          .map((r) => r.value);

        if (uploadResults.length === 0) {
          // All uploads failed — remove pending files
          onFilesChange((prev) => {
            const pendingIds = new Set(pendingFiles.map((f) => f.id));
            return prev.filter((f) => !pendingIds.has(f.id));
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

        // Replace pending files with real ones
        onFilesChange((prev) => {
          const uploadedIds = new Set(pendingFiles.map((f) => f.id));
          const withoutTheseUploads = prev.filter(
            (f) => !uploadedIds.has(f.id),
          );
          return [...withoutTheseUploads, ...(data.files as EncounterFile[])];
        });

        // Signal context dialog for non-audio uploads
        const uploadedFiles = data.files as EncounterFile[];
        const hasNonAudioUploads = uploadedFiles.some(
          (f) =>
            !f.type.startsWith("audio/") &&
            f.source !== "recording" &&
            f.source !== "recording-upload",
        );
        if (hasNonAudioUploads) {
          onShouldPromptContextRef.current?.();
        }

        // Trigger extraction for each uploaded file (background)
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
                logger.debug(
                  `[extract] Completed extraction for ${file.name}`,
                );
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
                await new Promise((r) => setTimeout(r, extractConfig.retryDelayMs));
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
                await new Promise((r) => setTimeout(r, extractConfig.retryDelayMs));
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
        onFilesChange((prev) => {
          const pendingIds = new Set(pendingFiles.map((f) => f.id));
          return prev.filter((f) => !pendingIds.has(f.id));
        });
      } finally {
        setIsUploading(false);
      }
    },
    [visitId, onFilesChange, hasActiveRecording],
  );

  return {
    uploadFiles,
    isUploading,
  };
}
