"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/nav/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/shared/card";
import { Button } from "@/components/shared/button";
import { Skeleton } from "@/components/shared/skeleton";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Folder01Icon, Tick02Icon, FileEditIcon, Loading03Icon } from "@hugeicons/core-free-icons";
import { useCreateEncounter } from "@/hooks/use-create-encounter";
import type { EncounterListResponse } from "@/lib/types";

interface Stats {
  total: number;
  started: number;
  completed: number;
}

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const tEncounters = useTranslations("encounters");
  const tNav = useTranslations("nav");
  const { createEncounter, isCreating } = useCreateEncounter();

  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
        // Silently fail — stats are non-critical
      } finally {
        setIsLoading(false);
      }
    }
    fetchStats();
  }, []);

  return (
    <AppShell>
      <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("welcome")}</h1>
        </div>

        {/* Stats cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {tEncounters("title")}
              </CardTitle>
              <HugeiconsIcon icon={Folder01Icon} size={16} className="text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold">{stats?.total ?? 0}</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {tEncounters("status.started")}
              </CardTitle>
              <HugeiconsIcon icon={FileEditIcon} size={16} className="text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold">{stats?.started ?? 0}</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {tEncounters("status.completed")}
              </CardTitle>
              <HugeiconsIcon icon={Tick02Icon} size={16} className="text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold">{stats?.completed ?? 0}</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* New Encounter CTA */}
        <Card>
          <CardContent className="flex items-center justify-between py-6">
            <div>
              <h3 className="font-medium">{tNav("newEncounter")}</h3>
              <p className="text-sm text-muted-foreground">{tEncounters("empty.description")}</p>
            </div>
            <Button onClick={() => createEncounter()} disabled={isCreating}>
              {isCreating ? (
                <HugeiconsIcon icon={Loading03Icon} size={16} className="animate-spin" />
              ) : (
                <HugeiconsIcon icon={Add01Icon} size={16} />
              )}
              {tNav("newEncounter")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
