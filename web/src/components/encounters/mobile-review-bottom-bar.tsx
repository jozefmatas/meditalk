"use client";

import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import { SparklesIcon, Loading03Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/shared/button";

interface MobileReviewBottomBarProps {
  onAdjust: () => void;
  isProcessing: boolean;
}

export function MobileReviewBottomBar({
  onAdjust,
  isProcessing,
}: MobileReviewBottomBarProps) {
  const t = useTranslations("encounters");

  return (
    <div className="fixed bottom-0 left-0 z-10 flex w-full border-t border-border bg-background px-4 py-3 pb-safe desktop:hidden">
      <Button
        size="lg"
        className="w-full"
        onClick={onAdjust}
        disabled={isProcessing}
      >
        <HugeiconsIcon
          icon={isProcessing ? Loading03Icon : SparklesIcon}
          size={16}
          className={isProcessing ? "animate-spin" : ""}
        />
        {isProcessing ? t("detail.generatingEncounter") : t("detail.adjust")}
      </Button>
    </div>
  );
}
