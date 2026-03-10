"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/shared/card";
import { Button } from "@/components/shared/button";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Calendar01Icon,
  UserIcon,
  Tick01Icon,
  Clock01Icon,
  Delete01Icon,
} from "@hugeicons/core-free-icons";
import type { Encounter, EncounterStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

interface VisitCardProps {
  visit: Encounter;
  onDelete?: (visitId: string) => void;
}

const statusColors: Record<EncounterStatus, string> = {
  draft: "bg-status-draft/10 text-status-draft",
  recording: "bg-status-recording/10 text-status-recording",
  processing: "bg-status-processing/10 text-status-processing",
  review: "bg-status-review/10 text-status-review",
  closed: "bg-status-closed/10 text-status-closed",
  archived: "bg-status-archived/10 text-status-archived",
};

const statusIcons: Record<EncounterStatus, typeof Clock01Icon> = {
  draft: Clock01Icon,
  recording: Clock01Icon,
  processing: Clock01Icon,
  review: Clock01Icon,
  closed: Tick01Icon,
  archived: Delete01Icon,
};

export function VisitCard({ visit, onDelete }: VisitCardProps) {
  const t = useTranslations("encounters");
  const locale = useLocale();

  const getLocalizedHref = (href: string) => {
    const base = locale === "sk" ? "" : `/${locale}`;
    return `${base}${href}`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const StatusIcon = statusIcons[visit.status];

  return (
    <Card className="group transition-shadow hover:shadow-md">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <Link
            href={getLocalizedHref(`/encounters/${visit.id}`)}
            className="flex-1 min-w-0"
          >
            <div className="space-y-2">
              {/* Title */}
              <h3 className="font-medium truncate group-hover:text-primary transition-colors">
                {visit.title || t("untitled")}
              </h3>

              {/* Meta info */}
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                {/* Date */}
                <span className="flex items-center gap-1">
                  <HugeiconsIcon icon={Calendar01Icon} size={14} />
                  {formatDate(visit.visit_date)}
                </span>

                {/* Patient name */}
                {visit.patient_name && (
                  <span className="flex items-center gap-1">
                    <HugeiconsIcon icon={UserIcon} size={14} />
                    {visit.patient_name}
                  </span>
                )}
              </div>
            </div>
          </Link>

          {/* Right side: Status + Actions */}
          <div className="flex items-center gap-2">
            {/* Status badge */}
            <span
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
                statusColors[visit.status]
              )}
            >
              <HugeiconsIcon icon={StatusIcon} size={12} />
              {t(`status.${visit.status}`)}
            </span>

            {/* Delete button */}
            {onDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.preventDefault();
                  onDelete(visit.id);
                }}
              >
                <HugeiconsIcon icon={Delete01Icon} size={16} className="text-muted-foreground" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
