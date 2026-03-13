"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export type ReviewTab = "transcript" | "note" | "add-document";

interface ReviewTabsProps {
  activeTab: ReviewTab;
  onTabChange: (tab: ReviewTab) => void;
}

const TABS: ReviewTab[] = ["transcript", "note", "add-document"];

export function ReviewTabs({ activeTab, onTabChange }: ReviewTabsProps) {
  const t = useTranslations("encounters.detail");

  const labels: Record<ReviewTab, string> = {
    transcript: t("transcript"),
    note: t("note"),
    "add-document": t("addDocument"),
  };

  return (
    <div className="flex gap-4 border-b">
      {TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onTabChange(tab)}
          className={cn(
            "flex h-12 items-center px-2 text-sm transition-colors",
            tab === activeTab
              ? "border-b-2 border-primary font-medium text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {labels[tab]}
        </button>
      ))}
    </div>
  );
}
