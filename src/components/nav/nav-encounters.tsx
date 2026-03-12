"use client";

import { useEffect, useRef } from "react";
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

export function NavEncounters() {
  const t = useTranslations("encounters");
  const tNav = useTranslations("nav");
  const pathname = usePathname();
  const getHref = useLocalizedHref();
  const { visits, isLoading, hasMore, loadMore, deleteVisit, markComplete } =
    useSidebarEncounters();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  return (
    // Scroll only happens here; "Latest" label sticks at the top
    <div
      ref={scrollRef}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto group-data-[collapsible=icon]:hidden"
    >
      {/* Sticky label — stays visible while scrolling the list */}
      <span className="sticky top-0 z-10 bg-sidebar px-2 pb-2 text-xs text-sidebar-foreground/65">
        {tNav("latestEncounters")}
      </span>
      <SidebarMenu className="gap-0.5">
        {isLoading && visits.length === 0 ? (
          Array.from({ length: 5 }).map((_, i) => (
            <SidebarMenuItem key={i}>
              <SidebarMenuSkeleton />
            </SidebarMenuItem>
          ))
        ) : visits.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-sidebar-foreground/65">
            {t("empty.title")}
          </div>
        ) : (
          <>
            {visits.map((visit) => {
              const visitHref = getHref(`/encounters/${visit.id}`);
              const isActive = pathname === visitHref;
              return (
                <SidebarMenuItem key={visit.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive}
                    className={cn(
                      itemClass,
                      visit.status === "processing" &&
                        !isActive &&
                        "bg-sidebar-accent",
                    )}
                  >
                    <Link href={visitHref} title={visit.title || t("untitled")}>
                      {visit.status === "processing" ? (
                        <HugeiconsIcon
                          icon={Loading03Icon}
                          size={20}
                          className="shrink-0 animate-spin text-status-processing"
                        />
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
                    <DropdownMenuContent
                      side="right"
                      align="start"
                      className="min-w-44"
                    >
                      <DropdownMenuItem asChild>
                        <Link href={visitHref} className="gap-2">
                          <HugeiconsIcon icon={LinkSquare01Icon} size={16} />
                          {tNav("openVisit")}
                        </Link>
                      </DropdownMenuItem>
                      {visit.status === "to_review" && (
                        <DropdownMenuItem
                          onClick={() => markComplete(visit.id)}
                          className="gap-2"
                        >
                          <HugeiconsIcon icon={Tick02Icon} size={16} />
                          {tNav("markComplete")}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => deleteVisit(visit.id)}
                        className="gap-2"
                      >
                        <HugeiconsIcon icon={Delete01Icon} size={16} />
                        {tNav("deleteVisit")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SidebarMenuItem>
              );
            })}
            {hasMore && <div ref={sentinelRef} className="h-1 shrink-0" />}
          </>
        )}
      </SidebarMenu>
    </div>
  );
}
