"use client";

import { useState } from "react";
import type { Encounter, EncounterType } from "@/lib/types";

interface UseEncounterMetadataOptions {
  visitId: string;
  visit: Encounter | null;
  setVisit: React.Dispatch<React.SetStateAction<Encounter | null>>;
}

export function useEncounterMetadata({
  visitId,
  visit,
  setVisit,
}: UseEncounterMetadataOptions) {
  const [title, setTitle] = useState("");
  const [patientName, setPatientName] = useState("");
  const [patientId, setPatientId] = useState("");
  const [visitType, setVisitType] = useState<EncounterType>("consultation");

  const handleMetadataBlur = async () => {
    if (!visit) return;

    const updates: Record<string, unknown> = {};
    if (title !== (visit.title || "")) updates.title = title.trim() || null;
    if (patientName !== (visit.patient_name || ""))
      updates.patient_name = patientName.trim() || null;
    if (visitType !== visit.visit_type) updates.visit_type = visitType;

    if (Object.keys(updates).length === 0) return;

    try {
      await fetch(`/api/encounters/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      setVisit((prev) =>
        prev ? ({ ...prev, ...updates } as Encounter) : prev,
      );
    } catch {
      // Silent fail
    }
  };

  const handlePatientBlur = async () => {
    if (!visit) return;

    const updates: Record<string, unknown> = {};
    if (patientName !== (visit.patient_name || ""))
      updates.patient_name = patientName.trim() || null;

    const meta = (visit.metadata || {}) as Record<string, unknown>;
    const storedPersonalId = (meta.patient_personal_id as string) || "";
    if (patientId !== storedPersonalId) {
      updates.metadata = {
        ...meta,
        patient_personal_id: patientId.trim() || null,
      };
    }

    if (Object.keys(updates).length === 0) return;

    try {
      await fetch(`/api/encounters/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      setVisit((prev) =>
        prev ? ({ ...prev, ...updates } as Encounter) : prev,
      );
    } catch {
      // Silent fail
    }
  };

  return {
    title,
    setTitle,
    patientName,
    setPatientName,
    patientId,
    setPatientId,
    visitType,
    setVisitType,
    handleMetadataBlur,
    handlePatientBlur,
  };
}
