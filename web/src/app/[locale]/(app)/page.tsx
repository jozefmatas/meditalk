"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { AppShell } from "@/components/nav/app-shell";
import { Button } from "@/components/shared/button";
import { Badge } from "@/components/shared/badge";
import { Skeleton } from "@/components/shared/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shared/select";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { useHeaderActions } from "@/components/nav/header-actions-context";
import { useCreateEncounter } from "@/hooks/use-create-encounter";
import {
  useEncounterStats,
  type TimePeriod,
} from "@/hooks/use-encounter-stats";
import { TemplateIcon } from "@/components/templates/template-icon";
import {
  sortTemplatesByUsage,
  incrementTemplateUsage,
  fetchTemplateUsage,
} from "@/lib/templates/usage";
import { useLocalizedHref } from "@/hooks/use-localized-href";
import type { Template } from "@/lib/templates/types";
import { DataProcessingNotice } from "@/components/onboarding/data-processing-notice";

export default function HomePage() {
  const t = useTranslations("home");
  const tNav = useTranslations("nav");
  const locale = useLocale();
  const getHref = useLocalizedHref();
  const { setHeaderActions } = useHeaderActions();
  const { createEncounter, isCreating } = useCreateEncounter();

  const [timePeriod, setTimePeriod] = useState<TimePeriod>("week");
  const { stats, isLoading: isStatsLoading } = useEncounterStats(timePeriod);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [isTemplatesLoading, setIsTemplatesLoading] = useState(true);
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(
    null,
  );

  // Fetch templates + usage counts in parallel
  useEffect(() => {
    async function loadTemplates() {
      try {
        const [templatesRes, usage] = await Promise.all([
          fetch("/api/templates"),
          fetchTemplateUsage(),
        ]);
        if (!templatesRes.ok) throw new Error("Failed to fetch templates");
        const data: Template[] = await templatesRes.json();

        // Sort by server-side usage and take top 4
        const sorted = sortTemplatesByUsage(data, usage);
        setTemplates(sorted.slice(0, 4));
      } catch {
        // Silently fail — templates are non-critical
      } finally {
        setIsTemplatesLoading(false);
      }
    }
    loadTemplates();
  }, []);

  // Set header actions (New encounter button)
  useEffect(() => {
    setHeaderActions(
      <Button size="lg" onClick={() => createEncounter()} disabled={isCreating}>
        {isCreating ? (
          <HugeiconsIcon
            icon={Loading03Icon}
            size={16}
            className="animate-spin"
          />
        ) : null}
        {tNav("newEncounter")}
      </Button>,
    );

    return () => setHeaderActions(null);
  }, [createEncounter, isCreating, setHeaderActions, tNav]);

  const handleUseTemplate = (templateId: string) => {
    setCreatingTemplateId(templateId);
    incrementTemplateUsage(templateId);
    createEncounter(templateId);
  };

  return (
    <>
      <AppShell contentClassName="flex-1 overflow-y-auto p-6 pt-0">
        <div className="flex flex-1 items-start justify-center">
          <div className="flex w-full max-w-3xl flex-col gap-6">
            {/* Stats section */}
            <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-background py-6 md:pl-4 pr-0 md:static md:bg-transparent">
              <div className="flex flex-1 gap-[15%]">
                <div className="flex items-baseline gap-1">
                  {isStatsLoading ? (
                    <Skeleton className="h-6 w-12" />
                  ) : (
                    <span className="text-2xl md:text-3xl leading-none">
                      {stats?.count ?? 0}
                    </span>
                  )}
                  <span className="text-xs leading-none opacity-65">
                    {t("encounters")}
                  </span>
                </div>
                <div className="flex items-baseline gap-1">
                  {isStatsLoading ? (
                    <Skeleton className="h-6 w-12" />
                  ) : (
                    <span className="text-2xl md:text-3xl leading-none">
                      {stats?.minsSaved ?? 0}
                    </span>
                  )}
                  <span className="text-xs leading-none opacity-65">
                    {t("minsSaved")}
                  </span>
                </div>
              </div>

              {/* Time period selector */}
              <Select
                value={timePeriod}
                onValueChange={(v) => setTimePeriod(v as TimePeriod)}
              >
                <SelectTrigger className="hidden w-auto md:flex">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">{t("period.week")}</SelectItem>
                  <SelectItem value="month">{t("period.month")}</SelectItem>
                  <SelectItem value="year">{t("period.year")}</SelectItem>
                  <SelectItem value="all">{t("period.all")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Templates section */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between md:pl-4 pr-0">
                <h2 className="text-2xl leading-none">
                  {t("templates.title")}
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  asChild
                  className="px-0 hover:bg-transparent hover:opacity-75"
                >
                  <Link href={getHref("/templates")}>
                    {t("templates.seeAll")}
                    <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
                  </Link>
                </Button>
              </div>

              {/* Templates grid */}
              <div className="flex flex-col gap-4">
                {isTemplatesLoading ? (
                  // Loading skeletons
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {[...Array(4)].map((_, i) => (
                      <Skeleton key={i} className="h-44 rounded-2xl" />
                    ))}
                  </div>
                ) : templates.length === 0 ? (
                  <p className="px-5 text-sm text-muted-foreground">
                    No templates found
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {templates.map((template) => {
                      const specialty = template.specialties?.[0];
                      const specialtyLabel = specialty
                        ? t(`specialties.${specialty}`)
                        : "General";

                      return (
                        <div
                          key={template.id}
                          className="flex flex-col gap-4 rounded-2xl border bg-accent/50 p-4"
                        >
                          <div className="flex items-center gap-4">
                            <TemplateIcon specialty={specialty} size={56} />
                            <div className="flex min-w-0 flex-1 flex-col gap-2">
                              <p className="text-sm font-medium leading-tight">
                                {template.name[locale] ??
                                  template.name.sk ??
                                  template.id}
                              </p>
                              <Badge
                                variant="status-started"
                                className="w-fit text-xs"
                              >
                                {specialtyLabel}
                              </Badge>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            onClick={() => handleUseTemplate(template.id)}
                            disabled={isCreating}
                          >
                            {creatingTemplateId === template.id ? (
                              <HugeiconsIcon
                                icon={Loading03Icon}
                                size={16}
                                className="animate-spin"
                              />
                            ) : null}
                            {t("templates.use")}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </AppShell>
      <DataProcessingNotice />
    </>
  );
}
