"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/nav/app-shell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/shared/card";
import { Button } from "@/components/shared/button";
import { Skeleton } from "@/components/shared/skeleton";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, NoteIcon } from "@hugeicons/core-free-icons";
import { useLocalizedHref } from "@/hooks/use-localized-href";
import { TEMPLATES, type Template } from "@/lib/templates";
import { flattenSectionIds } from "@/lib/templates/html";

export default function TemplatesPage() {
  const t = useTranslations("templates");
  const getHref = useLocalizedHref();
  const [templates, setTemplates] = useState<Template[]>(TEMPLATES);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchTemplates() {
      try {
        const res = await fetch("/api/templates");
        if (res.ok) {
          const data: Template[] = await res.json();
          if (data.length > 0) {
            setTemplates(data);
          }
        }
      } catch {
        // Static fallback already set
      } finally {
        setIsLoading(false);
      }
    }
    fetchTemplates();
  }, []);

  return (
    <AppShell>
      <div className="max-w-3xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>

        <div className="space-y-4">
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}>
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-9 w-9 rounded-lg" />
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-3 w-64" />
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              ))
            : templates.map((template) => {
                const sectionCount = flattenSectionIds(template).length;
                return (
                  <Card key={template.id}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                            <HugeiconsIcon icon={NoteIcon} size={18} />
                          </div>
                          <div>
                            <CardTitle className="text-base">
                              {template.name || t(`${template.id}.name`)}
                            </CardTitle>
                            <p className="text-sm text-muted-foreground">
                              {template.description ||
                                t(`${template.id}.description`)}
                            </p>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={getHref(`/templates/${template.id}`)}>
                            {t("viewTemplate")}
                            <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
                          </Link>
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-muted-foreground">
                        {t("sectionCount", { count: sectionCount })}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
        </div>
      </div>
    </AppShell>
  );
}
