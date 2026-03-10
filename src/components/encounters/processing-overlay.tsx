"use client";

import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import { MagicWand01Icon } from "@hugeicons/core-free-icons";
import { Spiral } from "./spiral";

export function ProcessingOverlay() {
  const t = useTranslations("encounters.detail");

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-12">
      <div className="relative size-60">
        <Spiral className="size-60 text-muted-foreground" dotColor="currentColor" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex size-20 items-center justify-center rounded-full bg-primary">
            <HugeiconsIcon
              icon={MagicWand01Icon}
              size={24}
              className="text-primary-foreground"
            />
          </div>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("generatingEncounter")}
      </p>
    </div>
  );
}
