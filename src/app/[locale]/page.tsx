"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/nav/app-shell";
import { VisitList } from "@/components/visits/visit-list";
import type { Visit, VisitListResponse } from "@/lib/types";

export default function DashboardPage() {
  const t = useTranslations("dashboard");

  const [visits, setVisits] = useState<Visit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const limit = 10;

  const fetchVisits = useCallback(async (pageNum: number, search?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        page: pageNum.toString(),
        limit: limit.toString(),
      });
      if (search) params.set("search", search);

      const res = await fetch(`/api/visits?${params}`);
      if (!res.ok) throw new Error("Failed to fetch visits");

      const data: VisitListResponse = await res.json();

      if (pageNum === 1) {
        setVisits(data.visits);
      } else {
        setVisits((prev) => [...prev, ...data.visits]);
      }
      setTotal(data.total);
    } catch {
      setError("Failed to load visits");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVisits(1);
  }, [fetchVisits]);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    setPage(1);
    fetchVisits(1, query);
  };

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchVisits(nextPage, searchQuery);
  };

  const handleDelete = async (visitId: string) => {
    try {
      const res = await fetch(`/api/visits/${visitId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete visit");
      setVisits((prev) => prev.filter((v) => v.id !== visitId));
      setTotal((prev) => prev - 1);
    } catch {
      setError("Failed to delete visit");
    }
  };

  const hasMore = visits.length < total;

  return (
    <AppShell>
      <div className="max-w-4xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">{t("recentVisits")}</h1>
        </div>

        <VisitList
          visits={visits}
          isLoading={isLoading}
          error={error}
          onDelete={handleDelete}
          onSearch={handleSearch}
          onLoadMore={handleLoadMore}
          hasMore={hasMore}
        />
      </div>
    </AppShell>
  );
}
