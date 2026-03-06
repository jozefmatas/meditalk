"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import { MoreHorizontalIcon, Delete01Icon, Tick02Icon, LinkSquare01Icon } from "@hugeicons/core-free-icons";
import { useLocalizedHref } from "@/hooks/use-localized-href";
import { useSidebarVisits } from "@/hooks/use-sidebar-visits";
import {
  SidebarGroup,
  SidebarGroupLabel,
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

const statusColors: Record<string, string> = {
  draft: "bg-amber-500",
  completed: "bg-green-500",
  archived: "bg-gray-400",
};

export function NavVisits() {
  const t = useTranslations("visits");
  const tNav = useTranslations("nav");
  const pathname = usePathname();
  const getHref = useLocalizedHref();
  const { visits, isLoading, hasMore, loadMore, deleteVisit, markComplete } =
    useSidebarVisits();

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>{t("title")}</SidebarGroupLabel>
      <SidebarMenu>
        {isLoading && visits.length === 0 ? (
          Array.from({ length: 5 }).map((_, i) => (
            <SidebarMenuItem key={i}>
              <SidebarMenuSkeleton />
            </SidebarMenuItem>
          ))
        ) : visits.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            {t("empty.title")}
          </div>
        ) : (
          <>
            {visits.map((visit) => {
              const visitHref = getHref(`/visits/${visit.id}`);
              const isActive = pathname === visitHref;

              return (
                <SidebarMenuItem key={visit.id}>
                  <SidebarMenuButton asChild isActive={isActive}>
                    <Link href={visitHref} title={visit.title || t("untitled")}>
                      <span
                        className={`size-2 shrink-0 rounded-full ${statusColors[visit.status] || statusColors.draft}`}
                      />
                      <span>{visit.title || t("untitled")}</span>
                    </Link>
                  </SidebarMenuButton>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <SidebarMenuAction showOnHover>
                        <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
                      </SidebarMenuAction>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" align="start">
                      <DropdownMenuItem asChild>
                        <Link href={visitHref} className="gap-2">
                          <HugeiconsIcon icon={LinkSquare01Icon} size={16} />
                          {tNav("openVisit")}
                        </Link>
                      </DropdownMenuItem>
                      {visit.status === "draft" && (
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
                        onClick={() => deleteVisit(visit.id)}
                        className="gap-2 text-destructive focus:text-destructive"
                      >
                        <HugeiconsIcon icon={Delete01Icon} size={16} />
                        {tNav("deleteVisit")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SidebarMenuItem>
              );
            })}
            {hasMore && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={loadMore}
                  className="text-sidebar-foreground/70"
                >
                  <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
                  <span>{tNav("moreVisits")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </>
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}
