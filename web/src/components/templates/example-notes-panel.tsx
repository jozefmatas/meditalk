"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Upload04Icon,
  Add01Icon,
  Loading03Icon,
  Delete02Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/shared/button";
import { Textarea } from "@/components/shared/textarea";
import type { EditorSection } from "./section-editor";

interface ExampleNote {
  text: string;
  uploadedAt: string;
}

interface ExampleNotesPanelProps {
  notes: ExampleNote[];
  onNotesChange: (notes: ExampleNote[]) => void;
  styleGuide: string | null;
  onAutoGenerateSections: (text: string) => Promise<EditorSection[]>;
  isGeneratingSections: boolean;
  isAnalyzingStyle: boolean;
}

export function ExampleNotesPanel({
  notes,
  onNotesChange,
  styleGuide,
  onAutoGenerateSections,
  isGeneratingSections,
  isAnalyzingStyle,
}: ExampleNotesPanelProps) {
  const t = useTranslations("templateEditor");
  const [pasteText, setPasteText] = React.useState("");
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const addNote = (text: string) => {
    if (!text.trim()) return;
    onNotesChange([
      ...notes,
      { text: text.trim(), uploadedAt: new Date().toISOString() },
    ]);
    setPasteText("");
  };

  const removeNote = (index: number) => {
    onNotesChange(notes.filter((_, i) => i !== index));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      if (text.trim()) {
        addNote(text);
      }
    } catch {
      // File read error — ignore
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const latestNoteText = notes.length > 0 ? notes[notes.length - 1].text : pasteText;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">{t("exampleNotes")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("exampleNotesDescription")}
        </p>
      </div>

      {/* Paste area */}
      <div className="space-y-2">
        <Textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder={t("pasteNotesPlaceholder")}
          className="min-h-24 text-sm"
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => addNote(pasteText)}
            disabled={!pasteText.trim()}
          >
            <HugeiconsIcon icon={Add01Icon} size={14} />
            {t("addNote")}
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.doc,.docx,.pdf"
            onChange={handleFileUpload}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <HugeiconsIcon icon={Upload04Icon} size={14} />
            {t("uploadNotes")}
          </Button>

          {latestNoteText.trim() && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                onAutoGenerateSections(latestNoteText)
              }
              disabled={isGeneratingSections}
            >
              {isGeneratingSections ? (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="animate-spin"
                />
              ) : (
                <HugeiconsIcon icon={SparklesIcon} size={14} />
              )}
              {isGeneratingSections
                ? t("generatingSections")
                : t("autoGenerateSections")}
            </Button>
          )}
        </div>
      </div>

      {/* Stored notes list */}
      {notes.length > 0 && (
        <div className="space-y-2">
          {notes.map((note, idx) => (
            <div
              key={idx}
              className="flex items-start gap-2 rounded-md border p-3"
            >
              <p className="flex-1 text-xs text-muted-foreground line-clamp-3">
                {note.text}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeNote(idx)}
              >
                <HugeiconsIcon icon={Delete02Icon} size={12} />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Style guide */}
      {isAnalyzingStyle ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          <HugeiconsIcon
            icon={Loading03Icon}
            size={14}
            className="animate-spin"
          />
          {t("analyzingStyle")}
        </div>
      ) : styleGuide ? (
        <div className="rounded-md border bg-muted/30 p-4">
          <h4 className="mb-2 text-xs font-medium">{t("styleGuide")}</h4>
          <p className="whitespace-pre-wrap text-xs text-muted-foreground">
            {styleGuide}
          </p>
        </div>
      ) : notes.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("noStyleGuide")}</p>
      ) : null}
    </div>
  );
}
