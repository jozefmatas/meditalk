"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  MoreVerticalIcon,
  SparklesIcon,
  Loading03Icon,
  Delete01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useHeaderActions } from "@/components/nav/header-actions-context";
import { Button } from "@/components/shared/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/shared/dropdown-menu";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/shared/select";
import { LabeledSwitch } from "@/components/shared/switch";
import type { EncounterStatus, SupportedLanguage } from "@/lib/types";

const GENERATION_LANGUAGES: { value: SupportedLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "sk", label: "Slovenčina" },
  { value: "cs", label: "Čeština" },
];

interface EncounterHeaderActionsProps {
  status: EncounterStatus;
  generationLanguage: SupportedLanguage;
  onLanguageChange: (lang: SupportedLanguage) => void;
  onGenerate: (options?: { sendAsEmail?: boolean }) => void;
  onMarkComplete: () => void;
  onDelete: () => void;
  canGenerate: boolean;
}

export function EncounterHeaderActions({
  status,
  generationLanguage,
  onLanguageChange,
  onGenerate,
  onMarkComplete,
  onDelete,
  canGenerate,
}: EncounterHeaderActionsProps) {
  const t = useTranslations("encounters");
  const tNav = useTranslations("nav");
  const { setHeaderActions } = useHeaderActions();
  const isProcessing = status === "processing";
  const isDraft = status === "started" || status === "recording";
  const [sendAsEmail, setSendAsEmail] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("meditalk:sendAsEmail");
    return stored === null ? true : stored === "true";
  });

  const handleSendAsEmailChange = (checked: boolean) => {
    setSendAsEmail(checked);
    localStorage.setItem("meditalk:sendAsEmail", String(checked));
  };

  useEffect(() => {
    setHeaderActions(
      <>
        {/* 3-dot menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-lg" disabled={isProcessing}>
              <HugeiconsIcon icon={MoreVerticalIcon} size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {status === "to_review" && (
              <DropdownMenuItem onSelect={onMarkComplete}>
                <HugeiconsIcon icon={Tick02Icon} size={14} />
                {t("detail.markComplete")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <HugeiconsIcon icon={Delete01Icon} size={14} />
              {tNav("deleteVisit")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Generation language selector — draft only, desktop only */}
        {isDraft && (
          <div className="hidden desktop:block">
            <Select
              value={generationLanguage}
              onValueChange={(v) => onLanguageChange(v as SupportedLanguage)}
              disabled={isProcessing}
            >
              <SelectTrigger
                className="w-auto"
                label={t("detail.noteLanguage")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {GENERATION_LANGUAGES.map((lang) => (
                  <SelectItem key={lang.value} value={lang.value}>
                    {lang.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Send as email switch — draft only, desktop only */}
        {isDraft && (
          <div className="hidden desktop:block">
            <LabeledSwitch
              label={t("detail.sendAsEmail")}
              checked={sendAsEmail}
              onCheckedChange={handleSendAsEmailChange}
              disabled={isProcessing}
              className="**:data-[slot=switch-thumb]:data-checked:translate-x-[calc(100%-2px)]!"
            />
          </div>
        )}

        {/* Generate button — draft only, desktop only */}
        {isDraft && (
          <Button
            size="lg"
            onClick={() => onGenerate({ sendAsEmail })}
            disabled={isProcessing || !canGenerate}
            className="hidden desktop:inline-flex"
          >
            <HugeiconsIcon
              icon={isProcessing ? Loading03Icon : SparklesIcon}
              size={16}
              className={isProcessing ? "animate-spin" : ""}
            />
            {isProcessing ? t("detail.generating") : t("detail.generate")}
          </Button>
        )}
      </>,
    );

    return () => setHeaderActions(null);
  }, [
    status,
    isDraft,
    isProcessing,
    generationLanguage,
    canGenerate,
    sendAsEmail,
    onLanguageChange,
    onGenerate,
    onMarkComplete,
    onDelete,
    setHeaderActions,
    t,
    tNav,
  ]);

  return null;
}
