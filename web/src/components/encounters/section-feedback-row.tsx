"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle01Icon,
  AlertCircleIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/shared/button";
import { Textarea } from "@/components/shared/textarea";
import { Checkbox } from "@/components/shared/checkbox";
import { cn } from "@/lib/utils";

interface SectionFeedbackRowProps {
  rating: "up" | "down" | null;
  onThumbsUp: () => void;
  onSubmitFeedback: (detail: string, remember: boolean) => void;
  isRegenerating?: boolean;
  storageKey?: string;
}

export function SectionFeedbackRow({
  rating,
  onThumbsUp,
  onSubmitFeedback,
  isRegenerating = false,
  storageKey,
}: SectionFeedbackRowProps) {
  const t = useTranslations("encounters.detail.feedback");

  // Load draft from sessionStorage on mount using lazy initializers
  const [expanded, setExpanded] = useState(() => {
    if (!storageKey) return false;
    const stored = sessionStorage.getItem(storageKey);
    if (stored) {
      try {
        JSON.parse(stored);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  });

  const [feedbackText, setFeedbackText] = useState(() => {
    if (!storageKey) return "";
    const stored = sessionStorage.getItem(storageKey);
    if (stored) {
      try {
        const draft = JSON.parse(stored);
        return draft.text || "";
      } catch {
        return "";
      }
    }
    return "";
  });

  const [rememberForFuture, setRememberForFuture] = useState(() => {
    if (!storageKey) return false;
    const stored = sessionStorage.getItem(storageKey);
    if (stored) {
      try {
        const draft = JSON.parse(stored);
        return draft.remember || false;
      } catch {
        return false;
      }
    }
    return false;
  });

  // Save draft to sessionStorage on change
  useEffect(() => {
    if (!storageKey) return;
    if (expanded && (feedbackText || rememberForFuture)) {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ text: feedbackText, remember: rememberForFuture }),
      );
    } else if (!expanded) {
      sessionStorage.removeItem(storageKey);
    }
  }, [storageKey, expanded, feedbackText, rememberForFuture]);

  const handleLooksGood = () => {
    setExpanded(false);
    setFeedbackText("");
    setRememberForFuture(false);
    if (storageKey) sessionStorage.removeItem(storageKey);
    onThumbsUp();
  };

  const handleNeedsWork = () => {
    setExpanded(true);
  };

  const handleCancel = () => {
    setExpanded(false);
    setFeedbackText("");
    setRememberForFuture(false);
    if (storageKey) sessionStorage.removeItem(storageKey);
  };

  const handleSubmit = () => {
    if (!feedbackText.trim()) return;
    onSubmitFeedback(feedbackText.trim(), rememberForFuture);
    setExpanded(false);
    setFeedbackText("");
    setRememberForFuture(false);
    if (storageKey) sessionStorage.removeItem(storageKey);
  };

  const disabled = isRegenerating;

  return (
    <div className="flex flex-col gap-2">
      {/* Button row */}
      <div className="flex items-center gap-2">
        <Button
          variant={rating === "up" ? "default" : "outline"}
          size="sm"
          onClick={handleLooksGood}
          disabled={disabled}
          className={cn(
            "gap-1.5 transition-colors",
            rating === "up" &&
              "bg-green-600 text-white hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800",
          )}
        >
          <HugeiconsIcon icon={CheckmarkCircle01Icon} size={16} />
          {t("looksGood")}
        </Button>

        <Button
          variant={expanded ? "default" : "outline"}
          size="sm"
          onClick={handleNeedsWork}
          disabled={disabled}
          className="gap-1.5"
        >
          <HugeiconsIcon icon={AlertCircleIcon} size={16} />
          {t("needsWork")}
        </Button>
      </div>

      {/* Expanded textarea section */}
      {expanded && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
          <Textarea
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder={t("feedbackPlaceholder")}
            disabled={disabled}
            rows={3}
            className="resize-none"
          />

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={rememberForFuture}
              onCheckedChange={(checked) =>
                setRememberForFuture(checked === true)
              }
              disabled={disabled}
            />
            <span className="select-none">{t("rememberForFuture")}</span>
          </label>

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              disabled={disabled}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleSubmit}
              disabled={disabled || !feedbackText.trim()}
            >
              {t("submit")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
