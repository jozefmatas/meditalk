"use client";

import { use } from "react";
import { useTranslations, useLocale } from "next-intl";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/nav/app-shell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/shared/card";
import { HugeiconsIcon } from "@hugeicons/react";
import { NoteIcon } from "@hugeicons/core-free-icons";
import { resolveSectionLabel } from "@/lib/templates";
import type { TemplateSection } from "@/lib/templates";
import { useTemplate } from "@/hooks/use-template";
import { Skeleton } from "@/components/shared/skeleton";

interface PageProps {
  params: Promise<{ templateId: string }>;
}

export default function TemplateDetailPage({ params }: PageProps) {
  const { templateId } = use(params);
  const t = useTranslations("templates");
  const locale = useLocale();

  const { template, isLoading } = useTemplate(templateId);

  if (isLoading) {
    return (
      <AppShell>
        <div className="max-w-3xl space-y-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </AppShell>
    );
  }

  if (!template) return notFound();

  return (
    <AppShell>
      <div className="max-w-3xl">
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <HugeiconsIcon icon={NoteIcon} size={20} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {template.name[locale] ?? template.name.sk ?? template.id}
              </h1>
              <p className="text-muted-foreground">
                {template.description[locale] ?? template.description.sk ?? ""}
              </p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("sectionHeaders")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {template.sections.map((section) => (
                <SectionItem
                  key={section.id}
                  section={section}
                  locale={locale}
                  depth={0}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function SectionItem({
  section,
  locale,
  depth,
}: {
  section: TemplateSection;
  locale: string;
  depth: number;
}) {
  const hasSubsections = section.subsections && section.subsections.length > 0;

  return (
    <li>
      <div
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        <span className={depth === 0 ? "font-medium" : "text-muted-foreground"}>
          {resolveSectionLabel(section, locale)}
        </span>
      </div>
      {hasSubsections && (
        <ul>
          {section.subsections!.map((sub) => (
            <SectionItem
              key={sub.id}
              section={sub}
              locale={locale}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
