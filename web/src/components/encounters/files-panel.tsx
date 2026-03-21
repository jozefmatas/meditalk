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
import { uploadToStorage } from "@/lib/supabase/upload";

export interface EncounterFile {
  id: string;
  name: string;
  size: number;
  type: string;
  extracted_text?: string | null;
  source?: string;
}

interface FilesContentProps {
  visitId: string;
  files: EncounterFile[];
  onFilesChange: (files: EncounterFile[]) => void;
}

type FilesPanelProps = FilesContentProps;

function iconForType(type: string) {
  return type.startsWith("audio/") ? Mic01Icon : File01Icon;
}

export function FilesContent({
  visitId,
  files,
  onFilesChange,
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
      try {
        // Upload all files directly to Supabase Storage (bypasses Vercel limit)
        const results = await Promise.allSettled(
          allFiles.map(async (file) => {
            const { path, fileId } = await uploadToStorage(file, file.name, {
              encounterId: visitId,
            });
            return {
              id: fileId,
              name: file.name,
              size: file.size,
              type: file.type,
              path,
            };
          }),
        );

        const uploadResults = results
          .filter(
            (
              r,
            ): r is PromiseFulfilledResult<{
              id: string;
              name: string;
              size: number;
              type: string;
              path: string;
            }> => r.status === "fulfilled",
          )
          .map((r) => r.value);

        if (uploadResults.length === 0) {
          console.error("All file uploads failed");
          return;
        }

        // Register file metadata with the API (small JSON, no file bytes)
        const res = await fetch(`/api/encounters/${visitId}/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: uploadResults }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          console.error(
            "File metadata registration failed:",
            res.status,
            errData,
          );
          return;
        }

        const data = await res.json();
        onFilesChange([...files, ...data.files]);
      } catch (err) {
        console.error("File upload error:", err);
      } finally {
        setIsUploading(false);
      }
    },
    [visitId, files, onFilesChange],
  );

  const handleDelete = useCallback(
    async (fileId: string) => {
      try {
        const res = await fetch(
          `/api/encounters/${visitId}/files?fileId=${fileId}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          console.error("File delete failed:", res.status);
          return;
        }
        onFilesChange(files.filter((f) => f.id !== fileId));
      } catch (err) {
        console.error("File delete error:", err);
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
                        icon={iconForType(file.type)}
                        size={14}
                        className="shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {file.name}
                      </span>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        className="shrink-0 desktop:opacity-0 desktop:transition-opacity desktop:group-hover:opacity-100"
                        onClick={() => handleDelete(file.id)}
                      >
                        <HugeiconsIcon icon={Delete01Icon} size={12} />
                      </Button>
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

export function FilesPanel({ visitId, files, onFilesChange }: FilesPanelProps) {
  const t = useTranslations("encounters.detail");

  return (
    <div className="hidden desktop:flex w-[280px] shrink-0 flex-col gap-4 border-l bg-background p-6">
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
      />
    </div>
  );
}
