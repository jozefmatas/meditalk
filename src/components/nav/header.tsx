"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";

interface Breadcrumb {
  label: string;
  href?: string;
}

export function Header() {
  const t = useTranslations("nav");
  const tVisits = useTranslations("visits");
  const locale = useLocale();
  const pathname = usePathname();

  const getLocalizedHref = (href: string) => {
    const base = locale === "sk" ? "" : `/${locale}`;
    return `${base}${href}` || "/";
  };

  // Build breadcrumbs based on current path
  const buildBreadcrumbs = (): Breadcrumb[] => {
    const crumbs: Breadcrumb[] = [{ label: t("dashboard"), href: getLocalizedHref("") }];

    // Remove locale prefix for analysis
    const cleanPath = pathname.replace(`/${locale}`, "").replace(/^\//, "");
    const segments = cleanPath.split("/").filter(Boolean);

    if (segments[0] === "visits") {
      crumbs.push({ label: tVisits("title"), href: getLocalizedHref("") });

      if (segments[1] === "new") {
        crumbs.push({ label: tVisits("newVisit") });
      } else if (segments[1]) {
        // Visit detail - show truncated ID
        const visitId = segments[1];
        crumbs.push({ label: `${visitId.slice(0, 8)}...` });
      }
    } else if (segments[0] === "settings") {
      crumbs.push({ label: t("settings") });
    }

    return crumbs;
  };

  const breadcrumbs = buildBreadcrumbs();

  return (
    <header className="flex h-16 items-center justify-between border-b bg-card px-6">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-sm">
        {breadcrumbs.map((crumb, index) => (
          <span key={index} className="flex items-center gap-2">
            {index > 0 && (
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                size={14}
                className="text-muted-foreground"
              />
            )}
            {crumb.href && index < breadcrumbs.length - 1 ? (
              <Link
                href={crumb.href}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="font-medium">{crumb.label}</span>
            )}
          </span>
        ))}
      </nav>

      {/* Quick actions */}
      <div className="flex items-center gap-2">
        <Button asChild size="sm">
          <Link href={getLocalizedHref("/visits/new")}>
            <HugeiconsIcon icon={Add01Icon} size={16} />
            {tVisits("newVisit")}
          </Link>
        </Button>
      </div>
    </header>
  );
}
