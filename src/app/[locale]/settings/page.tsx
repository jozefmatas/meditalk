"use client";

import { useTranslations } from "next-intl";
import { AppShell } from "@/components/nav/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/language-switcher";

export default function SettingsPage() {
  const t = useTranslations("nav");

  return (
    <AppShell>
      <div className="max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">{t("settings")}</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Language / Jazyk / Jazyk</CardTitle>
          </CardHeader>
          <CardContent>
            <LanguageSwitcher />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
