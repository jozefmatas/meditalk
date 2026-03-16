"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useLocalizedHref } from "@/hooks/use-localized-href";
import { usePageTitle } from "./page-title-context";
import { useHeaderActions } from "./header-actions-context";
import { SidebarTrigger } from "@/components/shared/sidebar";
import { Separator } from "@/components/shared/separator";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/shared/breadcrumb";

interface BreadcrumbData {
  label: string;
  href?: string;
}

export function Header() {
  const t = useTranslations("nav");
  const tEncounters = useTranslations("encounters");
  const tTemplates = useTranslations("templates");
  const pathname = usePathname();
  const getHref = useLocalizedHref();
  const { pageTitle } = usePageTitle();
  const { headerActions } = useHeaderActions();

  const buildBreadcrumbs = (): BreadcrumbData[] => {
    const cleanPath = pathname
      .replace(/^\/(sk|cs|en)(?=\/|$)/, "")
      .replace(/^\//, "");
    const segments = cleanPath.split("/").filter(Boolean);

    if (segments[0] === "encounters") {
      const crumbs: BreadcrumbData[] = [
        { label: t("encounters"), href: getHref("") },
      ];

      if (segments[1] === "new") {
        crumbs.push({ label: tEncounters("untitled") });
      } else if (segments[1]) {
        crumbs.push({ label: pageTitle || tEncounters("untitled") });
      }

      return crumbs;
    }

    if (segments[0] === "templates") {
      const crumbs: BreadcrumbData[] = [
        { label: t("templates"), href: getHref("/templates") },
      ];

      if (segments[1]) {
        crumbs.push({ label: tTemplates(`${segments[1]}.name`) });
      }

      return crumbs;
    }

    if (segments[0] === "settings") {
      return [{ label: t("settings") }];
    }

    // Root — this is the encounters page
    return [{ label: t("encounters") }];
  };

  const breadcrumbs = buildBreadcrumbs();

  return (
    <header className="sticky top-0 z-10 flex h-13 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 self-auto! h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          {breadcrumbs.map((crumb, index) => {
            const isLast = index === breadcrumbs.length - 1;
            return (
              <React.Fragment key={index}>
                {index > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem>
                  {!isLast && crumb.href ? (
                    <BreadcrumbLink asChild>
                      <Link href={crumb.href}>{crumb.label}</Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </React.Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
      {headerActions && (
        <div className="ml-auto flex items-center gap-2">{headerActions}</div>
      )}
    </header>
  );
}
