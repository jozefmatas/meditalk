"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  MoreVerticalIcon,
  SparklesIcon,
  Loading03Icon,
  Delete01Icon,
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
  onGenerate: () => void;
  onMarkComplete: () => void;
  onDelete: () => void;
  canGenerate: boolean;
  isGenerating: boolean;
}

const DRAFT_STATUSES: EncounterStatus[] = [
  "started",
  "recording",
  "processing",
];

export function EncounterHeaderActions({
  status,
  generationLanguage,
  onLanguageChange,
  onGenerate,
  onMarkComplete,
  onDelete,
  canGenerate,
  isGenerating,
}: EncounterHeaderActionsProps) {
  const t = useTranslations("encounters");
  const tNav = useTranslations("nav");
  const { setHeaderActions } = useHeaderActions();
  const isDraft = DRAFT_STATUSES.includes(status);

  useEffect(() => {
    setHeaderActions(
      <>
        {/* 3-dot menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-lg">
              <HugeiconsIcon icon={MoreVerticalIcon} size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <HugeiconsIcon icon={Delete01Icon} size={14} />
              {tNav("deleteVisit")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Generation language selector — draft only */}
        {isDraft && (
          <Select
            value={generationLanguage}
            onValueChange={(v) => onLanguageChange(v as SupportedLanguage)}
          >
            <SelectTrigger className="w-auto" label={t("detail.noteLanguage")}>
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
        )}

        {/* Generate button — draft only */}
        {isDraft && (
          <Button
            size="lg"
            onClick={onGenerate}
            disabled={isGenerating || !canGenerate}
          >
            <HugeiconsIcon
              icon={isGenerating ? Loading03Icon : SparklesIcon}
              size={16}
              className={isGenerating ? "animate-spin" : ""}
            />
            {isGenerating ? t("detail.generating") : t("detail.generate")}
          </Button>
        )}
      </>,
    );

    return () => setHeaderActions(null);
  }, [
    status,
    generationLanguage,
    canGenerate,
    isGenerating,
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
