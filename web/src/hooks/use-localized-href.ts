"use client";

import { useLocale } from "next-intl";
import { routing } from "@/i18n/routing";

export function useLocalizedHref() {
  const locale = useLocale();

  return (href: string) => {
    const base = locale === routing.defaultLocale ? "" : `/${locale}`;
    return `${base}${href}` || "/";
  };
}
