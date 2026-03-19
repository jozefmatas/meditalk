"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/nav/app-shell";
import { Skeleton } from "@/components/shared/skeleton";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Folder01Icon,
  FileEditIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import {
  TemplateCard,
  AddTemplateCard,
} from "@/components/home/template-card";
import { useCreateEncounter } from "@/hooks/use-create-encounter";
import { useLocalizedHref } from "@/hooks/use-localized-href";
import type { Template } from "@/lib/templates/types";
import { STATIC_TEMPLATES } from "@/lib/templates";
import type { EncounterListResponse } from "@/lib/types";

interface TemplateWithUsage extends Template {
  usageCount?: number;
}

interface Stats {
  total: number;
  started: number;
  completed: number;
}

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const tTemplates = useTranslations("templates");
  const { createEncounter, isCreating } = useCreateEncounter();
  const getHref = useLocalizedHref();
  const router = useRouter();

  const [templates, setTemplates] = useState<TemplateWithUsage[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(
    null,
  );
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  useEffect(() => {
    async function fetchTemplates() {
      try {
        const res = await fetch("/api/templates");
        if (res.ok) {
          const data = await res.json();
          setTemplates(data.templates);
        } else {
          setTemplates(
            STATIC_TEMPLATES.map((tmpl) => ({ ...tmpl, usageCount: 0 })),
          );
        }
      } catch {
        setTemplates(
          STATIC_TEMPLATES.map((tmpl) => ({ ...tmpl, usageCount: 0 })),
        );
      } finally {
        setIsLoadingTemplates(false);
      }
    }
    fetchTemplates();
  }, []);

  useEffect(() => {
    async function fetchStats() {
      try {
        const [allRes, startedRes, completedRes] = await Promise.all([
          fetch("/api/encounters?limit=1"),
          fetch("/api/encounters?limit=1&status=started"),
          fetch("/api/encounters?limit=1&status=completed"),
        ]);

        const all: EncounterListResponse = await allRes.json();
        const startedData: EncounterListResponse = await startedRes.json();
        const completedData: EncounterListResponse = await completedRes.json();

        setStats({
          total: all.total,
          started: startedData.total,
          completed: completedData.total,
        });
      } catch {
        // Stats are non-critical
      } finally {
        setIsLoadingStats(false);
      }
    }
    fetchStats();
  }, []);

  const handleTemplateClick = async (templateId: string) => {
    if (isCreating) return;
    setCreatingTemplateId(templateId);
    await createEncounter(templateId);
    setCreatingTemplateId(null);
  };

  const resolveDisplayName = (template: TemplateWithUsage): string => {
    if (template.name) return template.name;
    if (template.nameKey) return tTemplates(`${template.nameKey}.name`);
    return template.id;
  };

  const resolveDisplayDescription = (
    template: TemplateWithUsage,
  ): string | undefined => {
    if (template.description) return template.description;
    if (template.descriptionKey)
      return tTemplates(`${template.descriptionKey}.description`);
    return undefined;
  };

  return (
    <AppShell>
      <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("welcome")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("selectTemplate")}
          </p>
        </div>

        {isLoadingTemplates ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                displayName={resolveDisplayName(template)}
                displayDescription={resolveDisplayDescription(template)}
                onClick={() => handleTemplateClick(template.id)}
                isLoading={creatingTemplateId === template.id}
              />
            ))}
            <AddTemplateCard
              label={t("addNewTemplate")}
              onClick={() => router.push(getHref("/templates/new"))}
            />
          </div>
        )}

        <div className="flex items-center gap-6 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <HugeiconsIcon icon={Folder01Icon} size={14} />
            <span>
              {t("totalEncounters")}:{" "}
              {isLoadingStats ? "\u2014" : (stats?.total ?? 0)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <HugeiconsIcon icon={FileEditIcon} size={14} />
            <span>
              {t("inProgress")}:{" "}
              {isLoadingStats ? "\u2014" : (stats?.started ?? 0)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <HugeiconsIcon icon={Tick02Icon} size={14} />
            <span>
              {t("completed")}:{" "}
              {isLoadingStats ? "\u2014" : (stats?.completed ?? 0)}
            </span>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
