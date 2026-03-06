"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useLocalizedHref } from "@/hooks/use-localized-href";
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
  const tVisits = useTranslations("visits");
  const tTemplates = useTranslations("templates");
  const pathname = usePathname();
  const getHref = useLocalizedHref();

  const buildBreadcrumbs = (): BreadcrumbData[] => {
    const crumbs: BreadcrumbData[] = [{ label: t("dashboard"), href: getHref("") }];

    // Remove locale prefix for analysis
    const cleanPath = pathname.replace(/^\/(sk|cs|en)/, "").replace(/^\//, "");
    const segments = cleanPath.split("/").filter(Boolean);

    if (segments[0] === "visits") {
      crumbs.push({ label: tVisits("title"), href: getHref("") });

      if (segments[1] === "new") {
        crumbs.push({ label: tVisits("newVisit") });
      } else if (segments[1]) {
        const visitId = segments[1];
        crumbs.push({ label: `${visitId.slice(0, 8)}...` });
      }
    } else if (segments[0] === "templates") {
      crumbs.push({ label: t("templates"), href: getHref("/templates") });

      if (segments[1]) {
        const templateId = segments[1];
        const nameKey = `${templateId}.name`;
        crumbs.push({ label: tTemplates(nameKey) });
      }
    } else if (segments[0] === "settings") {
      crumbs.push({ label: t("settings") });
    }

    return crumbs;
  };

  const breadcrumbs = buildBreadcrumbs();

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
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
    </header>
  );
}
