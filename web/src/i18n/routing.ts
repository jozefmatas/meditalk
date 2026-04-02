import { defineRouting } from "next-intl/routing";
import { clientEnv } from "@/lib/env/client";

export const routing = defineRouting({
  // Supported locales
  locales: ["sk", "cs", "en"],

  // Default locale - can be changed via environment variable
  defaultLocale: clientEnv.NEXT_PUBLIC_DEFAULT_LOCALE,

  // Only show locale prefix for non-default locales
  // e.g., / (Slovak default), /cs, /en
  localePrefix: "as-needed",

  // Cookie configuration for locale persistence
  localeCookie: {
    name: "NEXT_LOCALE",
    maxAge: 31536000, // 1 year
    sameSite: "lax",
  },

  // Enable automatic locale detection from:
  // - Cookie (NEXT_LOCALE)
  // - Accept-Language header
  localeDetection: true,
});

// Type helper for locale
export type Locale = (typeof routing.locales)[number];
