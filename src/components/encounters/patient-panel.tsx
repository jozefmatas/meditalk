"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/shared/input";

interface PatientPanelProps {
  patientName: string;
  patientId: string;
  onPatientNameChange: (name: string) => void;
  onPatientIdChange: (id: string) => void;
  onBlur: () => void;
}

export function PatientPanel({
  patientName,
  patientId,
  onPatientNameChange,
  onPatientIdChange,
  onBlur,
}: PatientPanelProps) {
  const t = useTranslations("encounters.detail");

  return (
    <div className="flex h-full w-[280px] shrink-0 flex-col gap-8 border-l bg-sidebar p-6">
      {/* Patient section */}
      <div className="flex flex-col gap-4">
        <h3 className="text-lg font-medium text-foreground">{t("patient")}</h3>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted-foreground">
            {t("patientName")}
          </label>
          <Input
            value={patientName}
            onChange={(e) => onPatientNameChange(e.target.value)}
            onBlur={onBlur}
            className="h-auto border-none bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted-foreground">
            {t("personalId")}
          </label>
          <Input
            value={patientId}
            onChange={(e) => onPatientIdChange(e.target.value)}
            onBlur={onBlur}
            className="h-auto border-none bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
          />
        </div>
      </div>

      {/* Codes placeholder */}
      <div className="flex flex-col gap-4">
        <h3 className="text-lg font-medium text-foreground">{t("codes")}</h3>
        <p className="text-xs text-muted-foreground">Coming soon</p>
      </div>
    </div>
  );
}
