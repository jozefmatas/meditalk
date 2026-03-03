"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/nav/app-shell";
import { useLocalizedHref } from "@/hooks/use-localized-href";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Folder01Icon, Tick02Icon, FileEditIcon } from "@hugeicons/core-free-icons";
import type { VisitListResponse } from "@/lib/types";

interface Stats {
  total: number;
  drafts: number;
  completed: number;
}

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const tVisits = useTranslations("visits");
  const tNav = useTranslations("nav");
  const getHref = useLocalizedHref();

  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const [allRes, draftRes, completedRes] = await Promise.all([
          fetch("/api/visits?limit=1"),
          fetch("/api/visits?limit=1&status=draft"),
          fetch("/api/visits?limit=1&status=completed"),
        ]);

        const all: VisitListResponse = await allRes.json();
        const drafts: VisitListResponse = await draftRes.json();
        const completed: VisitListResponse = await completedRes.json();

        setStats({
          total: all.total,
          drafts: drafts.total,
          completed: completed.total,
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
                {tVisits("title")}
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
                {tVisits("status.draft")}
              </CardTitle>
              <HugeiconsIcon icon={FileEditIcon} size={16} className="text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold">{stats?.drafts ?? 0}</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {tVisits("status.completed")}
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

        {/* New Visit CTA */}
        <Card>
          <CardContent className="flex items-center justify-between py-6">
            <div>
              <h3 className="font-medium">{tNav("newVisit")}</h3>
              <p className="text-sm text-muted-foreground">{tVisits("empty.description")}</p>
            </div>
            <Button asChild>
              <Link href={getHref("/visits/new")}>
                <HugeiconsIcon icon={Add01Icon} size={16} />
                {tNav("newVisit")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
