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
  // Mode per file: "actual" = use everything, "past" = distill to `contexts[id]`.
  // Seeded from existing `file.context`: non-empty → "past", else "actual".
  const [modes, setModes] = useState<Record<string, "actual" | "past">>({});

  // Seed local state from file contexts whenever the dialog opens or files change
  useEffect(() => {
    if (!open) return;
    const seededContexts: Record<string, string> = {};
    const seededModes: Record<string, "actual" | "past"> = {};
    for (const f of eligibleFiles) {
      const existing = f.context?.trim() ?? "";
      seededContexts[f.id] = existing;
      seededModes[f.id] = existing ? "past" : "actual";
    }
    setContexts(seededContexts);
    setModes(seededModes);
    // Only re-seed when dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleModeChange = (fileId: string, mode: "actual" | "past") => {
    setModes((prev) => ({ ...prev, [fileId]: mode }));
    if (mode === "actual") {
      // Clear the directive when switching to "actual" — pipeline uses
      // the whole file in that mode, and keeping stale text would be
      // confusing next time the dialog opens.
      setContexts((prev) => ({ ...prev, [fileId]: "" }));
    }
  };

  const handleSave = () => {
    // For "actual" mode, save empty context; for "past", save the
    // typed directive verbatim. Pipeline reads `file.context` and
    // treats empty == "take everything".
    const payload: Record<string, string> = {};
    for (const f of eligibleFiles) {
      payload[f.id] =
        modes[f.id] === "past" ? (contexts[f.id] ?? "").trim() : "";
    }
    onSave(payload);
    onOpenChange(false);
  };

  // Disable save when any file in "past" mode has no directive typed.
  const hasIncompletePast = eligibleFiles.some(
    (f) => modes[f.id] === "past" && !(contexts[f.id] ?? "").trim(),
  );

  if (eligibleFiles.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("fileContextTitle")}</DialogTitle>
          <DialogDescription>{t("fileContextDescription")}</DialogDescription>
        </DialogHeader>
        <div className="-mx-1 flex max-h-96 flex-col gap-5 overflow-y-auto px-1 py-1 -my-1">
          {eligibleFiles.map((file) => {
            const mode = modes[file.id] ?? "actual";
            return (
              <div key={file.id} className="flex flex-col gap-2">
                <label className="flex items-center gap-1.5 text-sm font-medium">
                  <HugeiconsIcon
                    icon={File01Icon}
                    size={14}
                    className="shrink-0 text-muted-foreground"
                  />
                  <span className="truncate">{file.name}</span>
                </label>

                <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-2">
                  <ModeOption
                    name={`mode-${file.id}`}
                    value="actual"
                    checked={mode === "actual"}
                    onChange={() => handleModeChange(file.id, "actual")}
                    title={t("fileContextModeActualTitle")}
                    help={t("fileContextModeActualHelp")}
                  />
                  <ModeOption
                    name={`mode-${file.id}`}
                    value="past"
                    checked={mode === "past"}
                    onChange={() => handleModeChange(file.id, "past")}
                    title={t("fileContextModePastTitle")}
                    help={t("fileContextModePastHelp")}
                  />
                </div>

                {mode === "past" && (
                  <Textarea
                    autoFocus
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
                )}
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("fileContextSkip")}
          </Button>
          <Button onClick={handleSave} disabled={hasIncompletePast}>
            {t("fileContextSave")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ModeOptionProps {
  name: string;
  value: "actual" | "past";
  checked: boolean;
  onChange: () => void;
  title: string;
  help: string;
}

function ModeOption({
  name,
  value,
  checked,
  onChange,
  title,
  help,
}: ModeOptionProps) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <div className="flex h-5 w-5 shrink-0 items-center justify-center">
        <input
          type="radio"
          name={name}
          value={value}
          checked={checked}
          onChange={onChange}
          className="accent-primary"
        />
      </div>
      <div className="flex flex-col">
        <span className="font-medium">{title}</span>
        <span className="text-xs text-foreground/65">{help}</span>
      </div>
    </label>
  );
}
