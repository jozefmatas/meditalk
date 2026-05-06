"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle01Icon,
  AlertCircleIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/shared/button";
import { Textarea } from "@/components/shared/textarea";
import { Checkbox } from "@/components/shared/checkbox";
import { RecordingBar } from "@/components/encounters/recording-bar";
import { cn } from "@/lib/utils";
import type { SupportedLanguage } from "@/lib/types";

interface SectionFeedbackRowProps {
  rating: "up" | "down" | null;
  onThumbsUp: () => void;
  onRemoveFeedback: () => void;
  onSubmitFeedback: (detail: string, remember: boolean) => void;
  isRegenerating?: boolean;
  storageKey?: string;
  visitId?: string;
  language?: SupportedLanguage;
}

export function SectionFeedbackRow({
  rating,
  onThumbsUp,
  onRemoveFeedback,
  onSubmitFeedback,
  isRegenerating = false,
  storageKey,
  visitId,
  language,
}: SectionFeedbackRowProps) {
  const t = useTranslations("encounters.detail.feedback");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // Auto-focus textarea when expanded
  useEffect(() => {
    if (expanded && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [expanded]);

  const handleLooksGood = () => {
    setExpanded(false);
    setFeedbackText("");
    setRememberForFuture(false);
    if (storageKey) sessionStorage.removeItem(storageKey);

    // Toggle: if already thumbs up, remove it; otherwise add it
    if (rating === "up") {
      onRemoveFeedback();
    } else {
      onThumbsUp();
    }
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
          variant="ghost"
          size="lg"
          onClick={handleLooksGood}
          disabled={disabled}
          className={cn(
            "gap-1.5 transition-colors border hover:text-status-completed hover:border-status-completed/15 hover:bg-status-completed/10",
            rating === "up"
              ? "border-status-completed/15 bg-status-completed/10 text-status-completed"
              : "border-border bg-background text-foreground",
          )}
        >
          <HugeiconsIcon icon={CheckmarkCircle01Icon} size={16} />
          {t("looksGood")}
        </Button>

        <Button
          variant="ghost"
          size="lg"
          onClick={handleNeedsWork}
          disabled={disabled}
          className={cn(
            "gap-1.5 transition-colors border hover:text-destructive hover:border-destructive/15 hover:bg-destructive/10",
            expanded
              ? "border-destructive/15 bg-destructive/10 text-destructive"
              : "border-border bg-background text-foreground",
          )}
        >
          <HugeiconsIcon icon={AlertCircleIcon} size={16} />
          {t("needsWork")}
        </Button>
      </div>

      {/* Expanded textarea section */}
      {expanded && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
          {/* Voice recording */}
          {visitId && language && (
            <RecordingBar
              visitId={visitId}
              language={language}
              skipConsent
              skipSessionPersistence
              onTranscriptionComplete={(text) => setFeedbackText(text)}
              disabled={disabled}
              buttonLabel={t("recordFeedback")}
            />
          )}

          <Textarea
            ref={textareaRef}
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder={t("feedbackPlaceholder")}
            disabled={disabled}
            rows={3}
            className="resize-none"
          />

          <div className="flex flex-col items-start gap-3 desktop:flex-row desktop:items-center desktop:justify-between">
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

            <div className="flex w-full items-center gap-2 desktop:w-auto">
              <Button
                variant="outline"
                size="lg"
                onClick={handleCancel}
                disabled={disabled}
                className="flex-1 desktop:flex-none"
              >
                {t("cancel")}
              </Button>
              <Button
                variant="default"
                size="lg"
                onClick={handleSubmit}
                disabled={disabled || !feedbackText.trim()}
                className="flex-1 desktop:flex-none"
              >
                {t("submit")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
