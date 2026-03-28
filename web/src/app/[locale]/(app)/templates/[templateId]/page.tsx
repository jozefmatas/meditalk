"use client";

import { use } from "react";
import { useTranslations, useLocale } from "next-intl";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/nav/app-shell";
import { Badge } from "@/components/shared/badge";
import { Button } from "@/components/shared/button";
import { Skeleton } from "@/components/shared/skeleton";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/shared/accordion";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { resolveSectionLabel } from "@/lib/templates";
import type { TemplateSection } from "@/lib/templates";
import { useTemplate } from "@/hooks/use-template";
import { useCreateEncounter } from "@/hooks/use-create-encounter";
import { incrementTemplateUsage } from "@/lib/templates/usage";

interface PageProps {
  params: Promise<{ templateId: string }>;
}

export default function TemplateDetailPage({ params }: PageProps) {
  const { templateId } = use(params);
  const t = useTranslations("templates");
  const tHome = useTranslations("home");
  const locale = useLocale();

  const { template, isLoading } = useTemplate(templateId);
  const { createEncounter, isCreating } = useCreateEncounter();

  const handleUseTemplate = () => {
    incrementTemplateUsage(templateId);
    createEncounter(templateId);
  };

  if (isLoading) {
    return (
      <AppShell contentClassName="flex-1 overflow-y-auto p-6 pt-0">
        <div className="flex flex-1 items-start justify-center">
          <div className="flex w-full max-w-3xl flex-col gap-6 pt-6">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-4 w-96" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        </div>
      </AppShell>
    );
  }

  if (!template) return notFound();

  const specialty = template.specialties?.[0] ?? "general";

  return (
    <AppShell contentClassName="flex-1 overflow-y-auto p-6 pt-0">
      <div className="flex flex-1 items-start justify-center">
        <div className="flex w-full max-w-3xl flex-col gap-6">
          {/* Sticky header */}
          <div className="sticky top-0 z-10 flex flex-col gap-6 border-b border-border bg-background py-6 md:px-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-2">
                <h1 className="text-2xl leading-none">
                  {template.name[locale] ?? template.name.sk ?? template.id}
                </h1>
                <div className="flex gap-2">
                  <Badge variant="status-processing">
                    {tHome(`specialties.${specialty}`)}
                  </Badge>
                  {template.isSystem && (
                    <Badge variant="status-started">{t("system")}</Badge>
                  )}
                </div>
              </div>
              <Button
                size="lg"
                className="hidden desktop:flex"
                onClick={handleUseTemplate}
                disabled={isCreating}
              >
                {isCreating && (
                  <HugeiconsIcon
                    icon={Loading03Icon}
                    size={16}
                    className="animate-spin"
                  />
                )}
                {t("useTemplate")}
              </Button>
            </div>

            {/* Description */}
            {(template.description[locale] ?? template.description.sk) && (
              <p className="text-base leading-none text-foreground/65">
                {template.description[locale] ?? template.description.sk}
              </p>
            )}
          </div>

          {/* Section headers as accordions */}
          <div className="flex flex-col md:px-4">
            <Accordion type="multiple" className="gap-1">
              {template.sections.map((section) => (
                <SectionAccordion
                  key={section.id}
                  section={section}
                  locale={locale}
                  depth={0}
                  noContextLabel={t("noContext")}
                />
              ))}
            </Accordion>
          </div>

          {/* Spacer for mobile bottom bar */}
          <div aria-hidden className="h-16 desktop:hidden" />
        </div>
      </div>

      {/* Mobile sticky bottom bar */}
      <div className="fixed bottom-0 left-0 z-10 flex w-full border-t border-border bg-background px-4 py-3 desktop:hidden">
        <Button
          size="lg"
          className="w-full"
          onClick={handleUseTemplate}
          disabled={isCreating}
        >
          {isCreating && (
            <HugeiconsIcon
              icon={Loading03Icon}
              size={16}
              className="animate-spin"
            />
          )}
          {t("useTemplate")}
        </Button>
      </div>
    </AppShell>
  );
}

function SectionAccordion({
  section,
  locale,
  depth,
  noContextLabel,
}: {
  section: TemplateSection;
  locale: string;
  depth: number;
  noContextLabel: string;
}) {
  const label = resolveSectionLabel(section, locale);
  const hasSubsections = section.subsections && section.subsections.length > 0;
  const isSubheader = depth > 0;

  return (
    <div className={isSubheader ? "pl-8" : "flex flex-col gap-1"}>
      <AccordionItem value={section.id} variant="bordered">
        <AccordionTrigger
          className={isSubheader ? "text-foreground/65" : "font-medium"}
        >
          {label}
        </AccordionTrigger>
        <AccordionContent>
          <p className="text-sm text-foreground/65">
            {section.context || noContextLabel}
          </p>
        </AccordionContent>
      </AccordionItem>
      {hasSubsections && (
        <Accordion type="multiple" className="gap-1">
          {section.subsections!.map((sub) => (
            <SectionAccordion
              key={sub.id}
              section={sub}
              locale={locale}
              depth={depth + 1}
              noContextLabel={noContextLabel}
            />
          ))}
        </Accordion>
      )}
    </div>
  );
}
