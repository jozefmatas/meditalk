"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import { SparklesIcon, Loading03Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/shared/button";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/shared/select";
import { LabeledSwitch } from "@/components/shared/switch";
import type { SupportedLanguage } from "@/lib/types";

const GENERATION_LANGUAGES: { value: SupportedLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "sk", label: "Slovenčina" },
  { value: "cs", label: "Čeština" },
];

interface MobileDraftBottomBarProps {
  generationLanguage: SupportedLanguage;
  onLanguageChange: (lang: SupportedLanguage) => void;
  onGenerate: (options?: { sendAsEmail?: boolean }) => void;
  canGenerate: boolean;
  isGenerating: boolean;
}

export function MobileDraftBottomBar({
  generationLanguage,
  onLanguageChange,
  onGenerate,
  canGenerate,
  isGenerating,
}: MobileDraftBottomBarProps) {
  const t = useTranslations("encounters");

  const [sendAsEmail, setSendAsEmail] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("meditalk:sendAsEmail");
    return stored === null ? true : stored === "true";
  });

  const handleSendAsEmailChange = (checked: boolean) => {
    setSendAsEmail(checked);
    localStorage.setItem("meditalk:sendAsEmail", String(checked));
  };

  return (
    <div className="fixed bottom-0 left-0 z-10 flex w-full flex-col gap-2 border-t border-border bg-background px-4 py-3 desktop:hidden">
      <Select
        value={generationLanguage}
        onValueChange={(v) => onLanguageChange(v as SupportedLanguage)}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {GENERATION_LANGUAGES.map((lang) => (
            <SelectItem key={lang.value} value={lang.value}>
              {lang.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-4">
        <LabeledSwitch
          label={t("detail.sendAsEmail")}
          checked={sendAsEmail}
          onCheckedChange={handleSendAsEmailChange}
        />
        <Button
          className="flex-1"
          onClick={() => onGenerate({ sendAsEmail })}
          disabled={isGenerating || !canGenerate}
        >
          <HugeiconsIcon
            icon={isGenerating ? Loading03Icon : SparklesIcon}
            size={16}
            className={isGenerating ? "animate-spin" : ""}
          />
          {isGenerating ? t("detail.generating") : t("detail.generate")}
        </Button>
      </div>
    </div>
  );
}
