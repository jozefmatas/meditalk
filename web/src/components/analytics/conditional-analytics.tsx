"use client";

import { Analytics } from "@vercel/analytics/next";
import { useCookieConsent } from "@/hooks/use-cookie-consent";

export function ConditionalAnalytics() {
  const { consent } = useCookieConsent();

  // Only load analytics if user has explicitly accepted cookies
  if (consent !== "accepted") {
    return null;
  }

  return <Analytics />;
}
