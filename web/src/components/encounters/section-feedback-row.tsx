"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { ThumbsUpIcon, ThumbsDownIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/shared/button";

interface SectionFeedbackRowProps {
  rating: "up" | "down" | null;
  onThumbsUp: () => void;
  onThumbsDown: () => void;
}

export function SectionFeedbackRow({
  rating,
  onThumbsUp,
  onThumbsDown,
}: SectionFeedbackRowProps) {
  return (
    <div className="flex items-center gap-0">
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="Thumbs up"
        data-active={rating === "up" ? "true" : "false"}
        onClick={onThumbsUp}
        className={
          rating === "up"
            ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
            : "text-foreground/65 hover:bg-emerald-500/10 hover:text-emerald-600"
        }
      >
        <HugeiconsIcon icon={ThumbsUpIcon} size={16} />
      </Button>
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="Thumbs down"
        data-active={rating === "down" ? "true" : "false"}
        onClick={onThumbsDown}
        className={
          rating === "down"
            ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
            : "text-foreground/65 hover:bg-destructive/10 hover:text-destructive"
        }
      >
        <HugeiconsIcon icon={ThumbsDownIcon} size={16} />
      </Button>
    </div>
  );
}
