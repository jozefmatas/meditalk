"use client";

import { use } from "react";
import { useTranslations } from "next-intl";
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
import { getTemplateById } from "@/lib/templates";
import type { TemplateSection } from "@/lib/templates";

interface PageProps {
  params: Promise<{ templateId: string }>;
}

export default function TemplateDetailPage({ params }: PageProps) {
  const { templateId } = use(params);
  const t = useTranslations("templates");
  const tSections = useTranslations("templates.sections");

  const template = getTemplateById(templateId);
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
                {t(`${template.id}.name`)}
              </h1>
              <p className="text-muted-foreground">
                {t(`${template.id}.description`)}
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
                  tSections={tSections}
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
  tSections,
  depth,
}: {
  section: TemplateSection;
  tSections: ReturnType<typeof useTranslations>;
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
          {section.label || tSections(section.labelKey ?? section.id)}
        </span>
      </div>
      {hasSubsections && (
        <ul>
          {section.subsections!.map((sub) => (
            <SectionItem
              key={sub.id}
              section={sub}
              tSections={tSections}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
