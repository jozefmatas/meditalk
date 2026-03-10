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
import type { Visit, VisitStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

interface VisitCardProps {
  visit: Visit;
  onDelete?: (visitId: string) => void;
}

const statusColors: Record<VisitStatus, string> = {
  draft: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  recording: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  processing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  review: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  closed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  archived: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
};

const statusIcons: Record<VisitStatus, typeof Clock01Icon> = {
  draft: Clock01Icon,
  recording: Clock01Icon,
  processing: Clock01Icon,
  review: Clock01Icon,
  closed: Tick01Icon,
  archived: Delete01Icon,
};

export function VisitCard({ visit, onDelete }: VisitCardProps) {
  const t = useTranslations("visits");
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
