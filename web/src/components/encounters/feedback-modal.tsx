"use client";

import { useState, useCallback } from "react";
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
import { Textarea } from "@/components/shared/textarea";

const FEEDBACK_CATEGORIES = [
  "hallucination",
  "missing-info",
  "wrong-section",
  "style",
  "medical-accuracy",
  "redundant",
  "other",
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

interface FeedbackModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { categories: string[]; detail: string }) => void;
  sectionTitle?: string;
}

export function FeedbackModal({
  open,
  onOpenChange,
  onSubmit,
  sectionTitle,
}: FeedbackModalProps) {
  const t = useTranslations("encounters.detail.feedback");

  const [selected, setSelected] = useState<Set<FeedbackCategory>>(new Set());
  const [detail, setDetail] = useState("");

  const toggle = useCallback((cat: FeedbackCategory) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const handleSubmit = () => {
    onSubmit({
      categories: Array.from(selected),
      detail: detail.trim(),
    });
    // Reset
    setSelected(new Set());
    setDetail("");
    onOpenChange(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setSelected(new Set());
      setDetail("");
    }
    onOpenChange(next);
  };

  const hasSelection = selected.size > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {sectionTitle
              ? t("modalTitleSection", { section: sectionTitle })
              : t("modalTitleGlobal")}
          </DialogTitle>
          <DialogDescription>{t("modalDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-wrap gap-2">
            {FEEDBACK_CATEGORIES.map((cat) => {
              const isSelected = selected.has(cat);
              return (
                <button
                  key={cat}
                  type="button"
                  role="button"
                  data-selected={isSelected ? "true" : "false"}
                  onClick={() => toggle(cat)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-foreground/65 hover:border-foreground/30"
                  }`}
                >
                  {t(`category.${cat}`)}
                </button>
              );
            })}
          </div>

          {hasSelection && (
            <Textarea
              placeholder={t("detailPlaceholder")}
              rows={3}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!hasSelection}>
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
