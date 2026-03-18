"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  MoreHorizontalIcon,
  Delete01Icon,
  Tick02Icon,
  LinkSquare01Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { useLocalizedHref } from "@/hooks/use-localized-href";
import { useSidebarEncounters } from "@/hooks/use-sidebar-encounters";
import type { Encounter } from "@/lib/types";
import { Button } from "@/components/shared/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shared/dialog";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuAction,
  SidebarMenuSkeleton,
} from "@/components/shared/sidebar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/shared/dropdown-menu";

const dotColor: Record<string, string> = {
  started: "bg-status-started",
  recording: "bg-status-recording",
  processing: "bg-status-processing",
  to_review: "bg-status-to_review",
  completed: "bg-status-completed",
  archived: "bg-status-archived",
};

const itemClass =
  "h-10 gap-1.5 px-1.5 py-0 rounded-lg group-data-[collapsible=icon]:p-1.5! group-has-[[data-sidebar=menu-action]:hover]/menu-item:!bg-transparent group-has-[[data-sidebar=menu-action][aria-expanded=true]]/menu-item:!bg-transparent";

const ONGOING_STATUSES = new Set([
  "started",
  "recording",
  "processing",
  "to_review",
]);

function EncounterItem({
  visit,
  isActive,
  href,
  t,
  tNav,
  onDelete,
  onMarkComplete,
}: {
  visit: Encounter;
  isActive: boolean;
  href: string;
  t: ReturnType<typeof useTranslations>;
  tNav: ReturnType<typeof useTranslations>;
  onDelete: (id: string) => void;
  onMarkComplete: (id: string) => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} className={itemClass}>
        <Link href={href} title={visit.title || t("untitled")}>
          {visit.status === "processing" ? (
            <span className="flex size-5 shrink-0 items-center justify-center">
              <HugeiconsIcon
                icon={Loading03Icon}
                size={14}
                className="animate-spin text-status-processing"
              />
            </span>
          ) : (
            <span className="flex size-5 shrink-0 items-center justify-center">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  dotColor[visit.status] || dotColor.started,
                  visit.status === "recording" && "animate-pulse",
                )}
              />
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <span
              className={cn(
                "truncate text-sm leading-tight",
                visit.status === "completed" && "line-through",
              )}
            >
              {visit.title || t("untitled")}
            </span>
            <span className="truncate text-xs font-normal leading-tight text-sidebar-foreground/65">
              {t(`status.${visit.status}`)}
            </span>
          </div>
        </Link>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover className="top-2!">
            <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="min-w-44">
          <DropdownMenuItem asChild>
            <Link href={href} className="gap-2">
              <HugeiconsIcon icon={LinkSquare01Icon} size={16} />
              {tNav("openVisit")}
            </Link>
          </DropdownMenuItem>
          {visit.status === "to_review" && (
            <DropdownMenuItem
              onClick={() => onMarkComplete(visit.id)}
              className="gap-2"
            >
              <HugeiconsIcon icon={Tick02Icon} size={16} />
              {tNav("markComplete")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onDelete(visit.id)}
            className="gap-2"
          >
            <HugeiconsIcon icon={Delete01Icon} size={16} />
            {tNav("deleteVisit")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

export function NavEncounters() {
  const t = useTranslations("encounters");
  const tNav = useTranslations("nav");
  const pathname = usePathname();
  const getHref = useLocalizedHref();
  const { visits, isLoading, hasMore, loadMore, deleteVisit, markComplete } =
    useSidebarEncounters();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Delete confirmation dialog
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const requestDelete = (id: string) => setDeleteTarget(id);
  const confirmDelete = () => {
    if (deleteTarget) deleteVisit(deleteTarget);
    setDeleteTarget(null);
  };

  const ongoing = useMemo(
    () => visits.filter((v) => ONGOING_STATUSES.has(v.status)),
    [visits],
  );
  const completed = useMemo(
    () => visits.filter((v) => v.status === "completed"),
    [visits],
  );

  // Infinite scroll — observe the sentinel at the bottom of the list
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { root, rootMargin: "100px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const renderItems = (items: Encounter[]) =>
    items.map((visit) => {
      const visitHref = getHref(`/encounters/${visit.id}`);
      const isActive = pathname === visitHref;
      return (
        <EncounterItem
          key={visit.id}
          visit={visit}
          isActive={isActive}
          href={visitHref}
          t={t}
          tNav={tNav}
          onDelete={requestDelete}
          onMarkComplete={markComplete}
        />
      );
    });

  return (
    <div
      ref={scrollRef}
      className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto group-data-[collapsible=icon]:hidden"
    >
      {isLoading && visits.length === 0 ? (
        <SidebarMenu className="gap-0.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <SidebarMenuItem key={i}>
              <SidebarMenuSkeleton />
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      ) : (
        <>
          {ongoing.length > 0 && (
            <div>
              <span className="sticky top-0 z-10 block bg-sidebar px-2 pb-2 text-xs text-sidebar-foreground/65">
                {tNav("ongoingEncounters")}
              </span>
              <SidebarMenu className="gap-0.5">
                {renderItems(ongoing)}
              </SidebarMenu>
            </div>
          )}
          {completed.length > 0 && (
            <div>
              <span
                className={cn(
                  "sticky top-0 z-10 block bg-sidebar px-2 pb-2 text-xs text-sidebar-foreground/65",
                  ongoing.length > 0 && "pt-3",
                )}
              >
                {tNav("completedEncounters")}
              </span>
              <SidebarMenu className="gap-0.5">
                {renderItems(completed)}
              </SidebarMenu>
            </div>
          )}
          {hasMore && <div ref={sentinelRef} className="h-1 shrink-0" />}
        </>
      )}
      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("delete.title")}</DialogTitle>
            <DialogDescription>{t("delete.message")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("delete.cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              {t("delete.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
