"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shared/dialog";
import { Button } from "@/components/shared/button";
import { logger } from "@/lib/logger";

interface RecordingConsentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConsent: () => void | Promise<void>;
}

export function RecordingConsentDialog({
  open,
  onOpenChange,
  onConsent,
}: RecordingConsentDialogProps) {
  const t = useTranslations("encounters.detail.recordingConsent");
  const [isProcessing, setIsProcessing] = useState(false);

  const handleConfirm = async () => {
    setIsProcessing(true);
    try {
      await onConsent();
      onOpenChange(false);
    } catch (error) {
      logger.error("Failed to save consent:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-foreground/80">{t("explanation")}</p>
          <p className="text-sm font-medium text-foreground/90">
            {t("confirmCheckbox")}
          </p>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isProcessing}
          >
            {t("cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={isProcessing}>
            {t("iConsent")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
