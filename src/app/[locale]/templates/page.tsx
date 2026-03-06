"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/nav/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/shared/card";
import { Button } from "@/components/shared/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, NoteIcon } from "@hugeicons/core-free-icons";
import { useLocalizedHref } from "@/hooks/use-localized-href";
import { TEMPLATES } from "@/lib/templates";
import { flattenSectionIds } from "@/lib/templates/html";

export default function TemplatesPage() {
  const t = useTranslations("templates");
  const getHref = useLocalizedHref();

  return (
    <AppShell>
      <div className="max-w-3xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>

        <div className="space-y-4">
          {TEMPLATES.map((template) => {
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
                          {t(`${template.id}.name`)}
                        </CardTitle>
                        <p className="text-sm text-muted-foreground">
                          {t(`${template.id}.description`)}
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
