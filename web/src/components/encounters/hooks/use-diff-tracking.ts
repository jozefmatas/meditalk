"use client";

import { useEffect, useRef, useCallback } from "react";

interface UseDiffTrackingOptions {
  visitId: string;
  templateId: string | undefined;
  currentNoteHtml: string;
  originalNoteHtml: string | undefined;
  /** Only track diffs after the note has been generated */
  enabled: boolean;
}

const DIFF_DEBOUNCE_MS = 10_000;

/**
 * Tracks diffs between the original generated note and the current edited version.
 * Sends diffs to the insights API with a 10-second debounce.
 * Also fires on unmount (navigate away) to capture final edits.
 */
export function useDiffTracking({
  visitId,
  templateId,
  currentNoteHtml,
  originalNoteHtml,
  enabled,
}: UseDiffTrackingOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastSentRef = useRef<string>("");
  const currentRef = useRef(currentNoteHtml);
  const originalRef = useRef(originalNoteHtml);
  const templateIdRef = useRef(templateId);
  const visitIdRef = useRef(visitId);
  const enabledRef = useRef(enabled);

  // Keep refs in sync
  currentRef.current = currentNoteHtml;
  originalRef.current = originalNoteHtml;
  templateIdRef.current = templateId;
  visitIdRef.current = visitId;
  enabledRef.current = enabled;

  const sendDiff = useCallback(() => {
    const current = currentRef.current;
    const original = originalRef.current;
    const tmplId = templateIdRef.current;
    const vId = visitIdRef.current;

    if (!tmplId || !original || !current || !enabledRef.current) return;

    // Skip if we already sent this exact version
    if (current === lastSentRef.current) return;

    // Skip if content hasn't changed from original (whitespace-normalized)
    const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
    if (normalize(current) === normalize(original)) return;

    lastSentRef.current = current;

    // Fire-and-forget
    fetch(`/api/templates/${tmplId}/insights/diff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitId: vId,
        currentHtml: current,
        originalHtml: original,
      }),
    }).catch(() => {
      // Non-critical
    });
  }, []);

  // Debounced diff tracking on note changes
  useEffect(() => {
    if (!enabled || !templateId || !originalNoteHtml) return;

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(sendDiff, DIFF_DEBOUNCE_MS);

    return () => clearTimeout(timerRef.current);
  }, [currentNoteHtml, enabled, templateId, originalNoteHtml, sendDiff]);

  // Send final diff on unmount (navigate away)
  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
      sendDiff();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
