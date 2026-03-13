"use client";

import { useLocale } from "next-intl";

export function useLocalizedHref() {
  const locale = useLocale();

  return (href: string) => {
    const base = locale === "sk" ? "" : `/${locale}`;
    return `${base}${href}` || "/";
  };
}
