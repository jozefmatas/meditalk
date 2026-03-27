"use client";

import { useCallback } from "react";
import { useLocale } from "next-intl";
import { routing } from "@/i18n/routing";

export function useLocalizedHref() {
  const locale = useLocale();

  return useCallback(
    (href: string) => {
      const base = locale === routing.defaultLocale ? "" : `/${locale}`;
      return `${base}${href}` || "/";
    },
    [locale],
  );
}
