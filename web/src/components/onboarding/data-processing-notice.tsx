"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shared/dialog";
import { Button } from "@/components/shared/button";
import { Checkbox } from "@/components/shared/checkbox";
import { useDataProcessingNotice } from "@/hooks/use-data-processing-notice";

/**
 * One-time modal shown during user onboarding to inform about data processing.
 * Blocks app usage until user accepts. Stores acceptance in Supabase user_metadata.
 */
export function DataProcessingNotice() {
  const t = useTranslations("onboarding.dataNotice");
  const { showNotice, accept, isLoading } = useDataProcessingNotice();
  const [agreed, setAgreed] = useState(false);

  if (isLoading || !showNotice) {
    return null;
  }

  const handleAccept = async () => {
    await accept();
  };

  return (
    <Dialog open={showNotice} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("intro")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <ul className="list-disc space-y-2 pl-6 text-sm">
            <li>{t("point1")}</li>
            <li>{t("point2")}</li>
            <li>{t("point3")}</li>
          </ul>
          <p className="text-sm">
            {t("learnMore")}{" "}
            <Link
              href="/privacy-policy"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("privacyPolicyLink")}
            </Link>
            .
          </p>
          <div className="flex items-center gap-3">
            <Checkbox
              id="data-processing-consent"
              checked={agreed}
              onCheckedChange={(checked) => setAgreed(checked === true)}
            />
            <label
              htmlFor="data-processing-consent"
              className="text-sm font-semibold peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              {t("checkbox")}
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleAccept} disabled={!agreed}>
            {t("continue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
