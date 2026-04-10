"use client";

import { useState, useRef, useCallback } from "react";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** How long to show "saved" before reverting to "idle". */
const SAVED_DISPLAY_MS = 2000;

/**
 * Lightweight save-status state machine.
 *
 * ```
 * idle ─> saving ─> saved ──(2 s)──> idle
 *                 └─> error
 * ```
 *
 * Calling `markSaving()` while "saved" is displayed cancels the auto-reset
 * so the UI transitions cleanly to the new saving state.
 */
export function useSaveStatus() {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const markSaving = useCallback(() => {
    clearTimer();
    setStatus("saving");
  }, [clearTimer]);

  const markSaved = useCallback(() => {
    clearTimer();
    setStatus("saved");
    timerRef.current = setTimeout(() => {
      setStatus("idle");
      timerRef.current = null;
    }, SAVED_DISPLAY_MS);
  }, [clearTimer]);

  const markError = useCallback(() => {
    clearTimer();
    setStatus("error");
  }, [clearTimer]);

  return { status, markSaving, markSaved, markError } as const;
}
