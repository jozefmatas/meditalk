"use client";

import { Textarea } from "@/components/shared/textarea";
import { Badge } from "@/components/shared/badge";
import type { EncounterStatus } from "@/lib/types";

interface ReviewHeaderProps {
  title: string;
  onTitleChange: (value: string) => void;
  onBlur: () => void;
  status: EncounterStatus;
  formattedDate: string;
  placeholder: string;
  statusLabel: string;
}

export function ReviewHeader({
  title,
  onTitleChange,
  onBlur,
  status,
  formattedDate,
  placeholder,
  statusLabel,
}: ReviewHeaderProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Textarea
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        rows={1}
        className="min-h-0 h-auto resize-none overflow-hidden rounded-none border-none bg-transparent px-0 py-0.5 text-2xl md:text-2xl shadow-none placeholder:text-foreground/65 focus-visible:ring-0"
        onInput={(e) => {
          const target = e.currentTarget;
          target.style.height = "auto";
          target.style.height = `${target.scrollHeight}px`;
        }}
        ref={(el) => {
          if (el) {
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
          }
        }}
      />
      <div className="flex items-center gap-3">
        <Badge variant={`status-${status}` as "status-started"}>
          {statusLabel}
        </Badge>
        <span className="text-sm text-foreground/65">{formattedDate}</span>
      </div>
    </div>
  );
}
