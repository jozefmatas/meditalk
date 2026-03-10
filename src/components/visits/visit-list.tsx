"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { VisitCard } from "./visit-card";
import { Input } from "@/components/shared/input";
import { Button } from "@/components/shared/button";
import { Skeleton } from "@/components/shared/skeleton";
import { Alert, AlertDescription } from "@/components/shared/alert";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Search01Icon,
  AlertCircleIcon,
  Folder01Icon,
} from "@hugeicons/core-free-icons";
import type { Visit } from "@/lib/types";

interface VisitListProps {
  visits: Visit[];
  isLoading?: boolean;
  error?: string | null;
  onDelete?: (visitId: string) => void;
  onSearch?: (query: string) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

export function VisitList({
  visits,
  isLoading,
  error,
  onDelete,
  onSearch,
  onLoadMore,
  hasMore,
}: VisitListProps) {
  const t = useTranslations("encounters");
  const [searchQuery, setSearchQuery] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch?.(searchQuery);
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <HugeiconsIcon icon={AlertCircleIcon} size={16} />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      {onSearch && (
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <HugeiconsIcon
              icon={Search01Icon}
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="outline">
            {t("search")}
          </Button>
        </form>
      )}

      {/* Loading state */}
      {isLoading && visits.length === 0 && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && visits.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
            <HugeiconsIcon icon={Folder01Icon} size={32} className="text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium">{t("empty.title")}</h3>
          <p className="text-sm text-muted-foreground mt-1">{t("empty.description")}</p>
        </div>
      )}

      {/* Visit list */}
      {visits.length > 0 && (
        <div className="space-y-3">
          {visits.map((visit) => (
            <VisitCard key={visit.id} visit={visit} onDelete={onDelete} />
          ))}
        </div>
      )}

      {/* Load more */}
      {hasMore && onLoadMore && (
        <div className="flex justify-center pt-4">
          <Button variant="outline" onClick={onLoadMore} disabled={isLoading}>
            {isLoading ? t("loading") : t("loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
