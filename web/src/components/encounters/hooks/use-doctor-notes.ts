"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSaveStatus, type SaveStatus } from "@/hooks/use-save-status";

/**
 * Doctor notes auto-save hook — extracted from the god hook.
 *
 * Handles:
 *   - 2-second debounced save via PATCH /api/encounters/:id
 *   - Save status tracking (idle → saving → saved / error)
 *   - Single retry after 3s on failure
 *   - No-op when value hasn't changed from initial
 */
export function useDoctorNotes(visitId: string) {
  const [doctorNotes, setDoctorNotes] = useState("");
  const initialRef = useRef("");
  const saveStatus = useSaveStatus();

  /** Seed from fetched visit data (call once on load). */
  const initFromVisit = useCallback((notes: string) => {
    setDoctorNotes(notes);
    initialRef.current = notes;
  }, []);

  // Auto-save with 2s debounce + single retry
  useEffect(() => {
    if (doctorNotes === initialRef.current) return;

    const timeout = setTimeout(async () => {
      saveStatus.markSaving();

      const doSave = async () => {
        const res = await fetch(`/api/encounters/${visitId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            metadata: { doctor_notes: doctorNotes },
          }),
        });
        if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      };

      try {
        await doSave();
        initialRef.current = doctorNotes;
        saveStatus.markSaved();
      } catch {
        // Single retry after 3s
        try {
          await new Promise((r) => setTimeout(r, 3000));
          await doSave();
          initialRef.current = doctorNotes;
          saveStatus.markSaved();
        } catch {
          saveStatus.markError();
        }
      }
    }, 2000);

    return () => clearTimeout(timeout);
  }, [doctorNotes, visitId, saveStatus]);

  return {
    doctorNotes,
    setDoctorNotes,
    saveStatus: saveStatus.status as SaveStatus,
    initFromVisit,
  };
}
