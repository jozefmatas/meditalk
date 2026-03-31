"use client";

import { useTranslations } from "next-intl";
import { Spiral } from "./spiral";
import { AnimatedMagicWand } from "./animated-magic-wand";
import { TextShimmer } from "@/components/shared/text-shimmer";

interface ProcessingOverlayProps {
  message?: string;
  estimatedSeconds?: number;
}

export function ProcessingOverlay({
  message,
  estimatedSeconds,
}: ProcessingOverlayProps) {
  const t = useTranslations("encounters.detail");

  // Format estimated time
  const formatEstimatedTime = (seconds: number): string => {
    if (seconds < 60) {
      return t("lessThanMinute");
    }
    const minutes = Math.ceil(seconds / 60);
    return minutes === 1 ? "1" : minutes.toString();
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-12">
      <div className="relative size-60">
        <Spiral className="size-60 text-muted-foreground" dotColor="#4444FF" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex size-20 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <AnimatedMagicWand size={24} loop />
          </div>
        </div>
      </div>
      <TextShimmer className="text-sm" duration={3}>
        {estimatedSeconds !== undefined
          ? t("generatingReadyIn", {
              time:
                estimatedSeconds < 60
                  ? t("lessThanMinute")
                  : t("minutesRemaining", {
                      minutes: formatEstimatedTime(estimatedSeconds),
                    }),
            })
          : (message ?? t("generatingEncounter"))}
      </TextShimmer>
    </div>
  );
}
