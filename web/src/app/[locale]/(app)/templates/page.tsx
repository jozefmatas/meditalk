import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/nav/app-shell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/shared/card";
import { Button } from "@/components/shared/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, NoteIcon } from "@hugeicons/core-free-icons";
import { routing } from "@/i18n/routing";
import { resolveAllTemplates } from "@/lib/templates/server";
import { flattenSectionIds } from "@/lib/templates/html";

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("templates");
  const templates = await resolveAllTemplates();

  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;

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
          {templates.map((template) => {
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
                          {template.name[locale] ??
                            template.name.sk ??
                            template.id}
                        </CardTitle>
                        <p className="text-sm text-muted-foreground">
                          {template.description[locale] ??
                            template.description.sk ??
                            ""}
                        </p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`${prefix}/templates/${template.id}`}>
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
