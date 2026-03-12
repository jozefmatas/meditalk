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
import { cn } from "@/lib/utils";

export interface EncounterFile {
  id: string;
  name: string;
  size: number;
  type: string;
  extracted_text?: string | null;
}

interface FilesPanelProps {
  visitId: string;
  files: EncounterFile[];
  onFilesChange: (files: EncounterFile[]) => void;
  /** Called when audio file(s) are dropped/selected — held in memory until Generate */
  onAudioFileAdded: (blob: Blob) => void;
  hasAudioFile: boolean;
}

function isAudioFile(file: File): boolean {
  return file.type.startsWith("audio/");
}

export function FilesPanel({
  visitId,
  files,
  onFilesChange,
  onAudioFileAdded,
  hasAudioFile,
}: FilesPanelProps) {
  const t = useTranslations("encounters.detail");
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFiles = useCallback(
    async (fileList: FileList) => {
      const allFiles = Array.from(fileList);
      const audioFiles = allFiles.filter(isAudioFile);
      const docFiles = allFiles.filter((f) => !isAudioFile(f));

      // Audio files → hold as blob in memory (transcription happens at Generate)
      for (const audioFile of audioFiles) {
        onAudioFileAdded(audioFile);
      }

      // Document files → upload to files endpoint
      if (docFiles.length > 0) {
        setIsUploading(true);
        try {
          const formData = new FormData();
          docFiles.forEach((f) => formData.append("files", f));

          const res = await fetch(`/api/encounters/${visitId}/files`, {
            method: "POST",
            body: formData,
          });

          if (!res.ok) throw new Error("Upload failed");

          const data = await res.json();
          onFilesChange([...files, ...data.files]);
        } catch {
          // Silent fail
        } finally {
          setIsUploading(false);
        }
      }
    },
    [visitId, files, onFilesChange, onAudioFileAdded],
  );

  const handleDelete = useCallback(
    async (fileId: string) => {
      try {
        const res = await fetch(
          `/api/encounters/${visitId}/files?fileId=${fileId}`,
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error("Delete failed");
        onFilesChange(files.filter((f) => f.id !== fileId));
      } catch {
        // Silent fail
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
    <div className="flex w-[280px] shrink-0 flex-col gap-4 border-l bg-background p-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-medium leading-none">{t("files")}</h3>
        <p className="text-sm leading-snug text-foreground/65">
          {t("filesDescription")}
        </p>
      </div>

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
        accept="image/*,.pdf,.doc,.docx,.txt,audio/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) uploadFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Audio file indicator */}
      {hasAudioFile && (
        <div className="flex items-center gap-1.5 text-sm text-status-completed">
          <HugeiconsIcon icon={Mic01Icon} size={14} className="shrink-0" />
          <span>{t("recorded")}</span>
        </div>
      )}

      {/* File list */}
      {files.length > 0 && (
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">
            {t("uploadedFiles")}
          </span>
          {files.map((file) => (
            <div
              key={file.id}
              className="group flex items-center gap-1 border-b py-3 text-sm"
            >
              <HugeiconsIcon
                icon={File01Icon}
                size={14}
                className="shrink-0 text-muted-foreground"
              />
              <span className="flex-1 truncate">{file.name}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleDelete(file.id)}
              >
                <HugeiconsIcon icon={Delete01Icon} size={12} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
