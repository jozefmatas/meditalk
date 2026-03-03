"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Search01Icon,
  Home01Icon,
  Add01Icon,
} from "@hugeicons/core-free-icons";
import { useLocalizedHref } from "@/hooks/use-localized-href";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";

interface NavMainProps {
  onSearchClick: () => void;
}

export function NavMain({ onSearchClick }: NavMainProps) {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const getHref = useLocalizedHref();

  const dashboardHref = getHref("");
  const isDashboard =
    pathname === dashboardHref || pathname === "/" || pathname.match(/^\/(sk|cs|en)$/);

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onSearchClick} tooltip={tCommon("search")}>
              <HugeiconsIcon icon={Search01Icon} size={16} />
              <span>{tCommon("search")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={!!isDashboard} tooltip={t("dashboard")}>
              <Link href={dashboardHref}>
                <HugeiconsIcon icon={Home01Icon} size={16} />
                <span>{t("dashboard")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname.includes("/visits/new")}
              tooltip={t("newVisit")}
            >
              <Link href={getHref("/visits/new")}>
                <HugeiconsIcon icon={Add01Icon} size={16} />
                <span>{t("newVisit")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
