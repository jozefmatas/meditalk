"use client";

import { useTranslations } from "next-intl";
import { Spiral } from "./spiral";
import { AnimatedMagicWand } from "./animated-magic-wand";
import { TextShimmer } from "@/components/shared/text-shimmer";

export function ProcessingOverlay({ message }: { message?: string }) {
  const t = useTranslations("encounters.detail");

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
        {message ?? t("generatingEncounter")}
      </TextShimmer>
    </div>
  );
}
