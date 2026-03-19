"use client";

import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  NoteIcon,
  Add01Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/shared/card";
import type { Template } from "@/lib/templates/types";
import { flattenSectionIds } from "@/lib/templates/html";

interface TemplateCardProps {
  template: Template & { usageCount?: number };
  displayName: string;
  displayDescription?: string;
  onClick: () => void;
  isLoading?: boolean;
}

export function TemplateCard({
  template,
  displayName,
  displayDescription,
  onClick,
  isLoading,
}: TemplateCardProps) {
  const t = useTranslations("dashboard");
  const sectionCount = flattenSectionIds(template).length;

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-accent/50"
      onClick={isLoading ? undefined : onClick}
    >
      <CardHeader className="flex flex-row items-center gap-3 pb-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          {isLoading ? (
            <HugeiconsIcon
              icon={Loading03Icon}
              size={18}
              className="animate-spin text-muted-foreground"
            />
          ) : (
            <HugeiconsIcon
              icon={NoteIcon}
              size={18}
              className="text-muted-foreground"
            />
          )}
        </div>
        <CardTitle className="text-sm font-medium leading-tight">
          {displayName}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {displayDescription && (
          <p className="mb-2 text-xs text-muted-foreground line-clamp-2">
            {displayDescription}
          </p>
        )}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{t("sectionCount", { count: sectionCount })}</span>
          {template.usageCount ? (
            <span>{t("usedCount", { count: template.usageCount })}</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

interface AddTemplateCardProps {
  label: string;
  onClick: () => void;
}

export function AddTemplateCard({ label, onClick }: AddTemplateCardProps) {
  return (
    <Card
      className="cursor-pointer border-dashed transition-colors hover:bg-accent/50"
      onClick={onClick}
    >
      <CardContent className="flex h-full flex-col items-center justify-center gap-2 py-8">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
          <HugeiconsIcon
            icon={Add01Icon}
            size={18}
            className="text-muted-foreground"
          />
        </div>
        <span className="text-sm font-medium text-muted-foreground">
          {label}
        </span>
      </CardContent>
    </Card>
  );
}
