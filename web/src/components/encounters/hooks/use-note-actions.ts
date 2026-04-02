import { useState, useCallback } from "react";
import type { Template } from "@/lib/templates";
import { buildTemplateHtml } from "@/lib/templates/html";
import {
  parseNoteSections,
  allSectionsToPlainText,
} from "@/lib/parse-note-sections";

interface UseNoteActionsParams {
  template: Template | undefined;
  sectionContents: Record<string, string>;
  removedSections: Set<string>;
  sectionLabels: Record<string, string>;
  generatedNoteHtml: string;
  visitId: string;
}

/**
 * Handles copy-to-clipboard and send-email actions for a generated note.
 *
 * Copy builds filtered HTML (excluding removed sections) and writes both
 * HTML and plaintext to the clipboard. Email POSTs to /api/send-note-email.
 */
export function useNoteActions({
  template,
  sectionContents,
  removedSections,
  sectionLabels,
  generatedNoteHtml,
  visitId,
}: UseNoteActionsParams) {
  const [noteCopied, setNoteCopied] = useState(false);
  const [emailStatus, setEmailStatus] = useState<
    "idle" | "sending" | "sent" | "failed"
  >("idle");

  const handleCopyNote = useCallback(async () => {
    const currentHtml =
      template && Object.keys(sectionContents).length > 0
        ? buildTemplateHtml(
            template,
            Object.fromEntries(
              Object.entries(sectionContents).filter(
                ([id]) => !removedSections.has(id),
              ),
            ),
            sectionLabels,
            { skipEmpty: true },
          )
        : generatedNoteHtml;
    const parsed = parseNoteSections(currentHtml);
    const plainText = allSectionsToPlainText(parsed);
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([currentHtml], { type: "text/html" }),
          "text/plain": new Blob([plainText], { type: "text/plain" }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(plainText);
    }
    setNoteCopied(true);
    setTimeout(() => setNoteCopied(false), 2000);
  }, [
    sectionContents,
    removedSections,
    template,
    sectionLabels,
    generatedNoteHtml,
  ]);

  const handleSendEmail = useCallback(async () => {
    if (emailStatus === "sending") return;
    setEmailStatus("sending");
    try {
      const res = await fetch("/api/send-note-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitId }),
      });
      if (!res.ok) throw new Error("Failed");
      setEmailStatus("sent");
      setTimeout(() => setEmailStatus("idle"), 3000);
    } catch {
      setEmailStatus("failed");
      setTimeout(() => setEmailStatus("idle"), 3000);
    }
  }, [visitId, emailStatus]);

  return { noteCopied, emailStatus, handleCopyNote, handleSendEmail };
}
