"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Search01Icon,
  Home02Icon,
  AddSquareIcon,
  DocumentValidationIcon,
} from "@hugeicons/core-free-icons";
import { useLocalizedHref } from "@/hooks/use-localized-href";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/shared/sidebar";

interface NavMainProps {
  onSearchClick: () => void;
}

/**
 * Figma item spec: h-9 (36px), gap-1.5 (6px), px-1.5 (6px), rounded-lg (~10px), icons 20px.
 * Overrides SidebarMenuButton defaults: h-8, gap-2, p-2, rounded-md, [&_svg]:size-4.
 */
const itemClass = "h-9 gap-1.5 px-1.5 py-0 rounded-lg [&_svg]:size-5 group-data-[collapsible=icon]:p-1.5!";

export function NavMain({ onSearchClick }: NavMainProps) {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const getHref = useLocalizedHref();

  const dashboardHref = getHref("");
  const isDashboard =
    pathname === dashboardHref || pathname === "/" || pathname.match(/^\/(sk|cs|en)$/);

  return (
    // Figma: gap-3 (12px) between [Actions] and [Nav]; padding handled by parent
    <div className="flex flex-col gap-3">
      {/* Action items */}
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            isActive={pathname.includes("/encounters/new")}
            tooltip={t("newEncounter")}
            className={itemClass}
          >
            <Link href={getHref("/encounters/new")}>
              <HugeiconsIcon icon={AddSquareIcon} size={20} className="text-primary" />
              <span>{t("newEncounter")}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            onClick={onSearchClick}
            tooltip={tCommon("search")}
            className={itemClass}
          >
            <HugeiconsIcon icon={Search01Icon} size={20} />
            <span>{tCommon("search")}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>

      {/* Main navigation */}
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            isActive={!!isDashboard}
            tooltip={t("encounters")}
            className={itemClass}
          >
            <Link href={dashboardHref}>
              <HugeiconsIcon icon={Home02Icon} size={20} />
              <span>{t("encounters")}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            isActive={pathname.includes("/templates")}
            tooltip={t("templates")}
            className={itemClass}
          >
            <Link href={getHref("/templates")}>
              <HugeiconsIcon icon={DocumentValidationIcon} size={20} />
              <span>{t("templates")}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </div>
  );
}
