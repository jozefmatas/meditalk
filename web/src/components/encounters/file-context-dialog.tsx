"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import { File01Icon } from "@hugeicons/core-free-icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shared/dialog";
import { Button } from "@/components/shared/button";
import { Textarea } from "@/components/shared/textarea";
import type { FileMetadata } from "@/lib/types";

interface FileContextDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** All encounter files — audio/recording files are filtered out internally. */
  files: FileMetadata[];
  /** Called with a map of fileId → context string. Empty string means clear. */
  onSave: (contexts: Record<string, string>) => void;
}

export function FileContextDialog({
  open,
  onOpenChange,
  files,
  onSave,
}: FileContextDialogProps) {
  const t = useTranslations("encounters.detail");

  // Filter to non-audio, non-pending files only
  const eligibleFiles = files.filter(
    (f) =>
      !f.type.startsWith("audio/") &&
      f.source !== "recording" &&
      f.source !== "recording-upload",
  );

  const [contexts, setContexts] = useState<Record<string, string>>({});

  // Seed local state from file contexts whenever the dialog opens or files change
  useEffect(() => {
    if (!open) return;
    const seeded: Record<string, string> = {};
    for (const f of eligibleFiles) {
      seeded[f.id] = f.context ?? "";
    }
    setContexts(seeded);
    // Only re-seed when dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSave = () => {
    onSave(contexts);
    onOpenChange(false);
  };

  if (eligibleFiles.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("fileContextTitle")}</DialogTitle>
          <DialogDescription>{t("fileContextDescription")}</DialogDescription>
        </DialogHeader>
        <div className="-mx-1 flex max-h-96 flex-col gap-4 overflow-y-auto px-1 py-1 -my-1">
          {eligibleFiles.map((file) => (
            <div key={file.id} className="flex flex-col gap-1.5">
              <label className="flex items-center gap-1.5 text-sm font-medium">
                <HugeiconsIcon
                  icon={File01Icon}
                  size={14}
                  className="shrink-0 text-muted-foreground"
                />
                <span className="truncate">{file.name}</span>
              </label>
              <Textarea
                placeholder={t("fileContextPlaceholder")}
                rows={2}
                value={contexts[file.id] ?? ""}
                onChange={(e) =>
                  setContexts((prev) => ({
                    ...prev,
                    [file.id]: e.target.value,
                  }))
                }
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("fileContextSkip")}
          </Button>
          <Button onClick={handleSave}>{t("fileContextSave")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
