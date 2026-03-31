"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/shared/button";
import { cn } from "@/lib/utils";

const COOKIE_CONSENT_KEY = "meditalk-cookie-consent";

export function CookieConsent() {
  const t = useTranslations("cookieConsent");
  // Start with closed state on both server and client to avoid hydration mismatch
  const [isOpen, setIsOpen] = useState(false);
  const [hide, setHide] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Check localStorage only after mount (client-side only)
  useEffect(() => {
    setMounted(true); // eslint-disable-line react-hooks/set-state-in-effect -- Necessary to avoid SSR hydration mismatch with localStorage
    try {
      const consent = localStorage.getItem(COOKIE_CONSENT_KEY);
      if (!consent) {
        setIsOpen(true);
      } else {
        setHide(true);
      }
    } catch {
      setHide(true);
    }
  }, []);

  const accept = () => {
    setIsOpen(false);
    localStorage.setItem(COOKIE_CONSENT_KEY, "accepted");
    setTimeout(() => {
      setHide(true);
    }, 700);
    // Reload to enable analytics
    window.location.reload();
  };

  const decline = () => {
    setIsOpen(false);
    localStorage.setItem(COOKIE_CONSENT_KEY, "declined");
    setTimeout(() => {
      setHide(true);
    }, 700);
  };

  // Don't render until mounted to avoid hydration mismatch
  if (!mounted || hide) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 p-4 duration-700 sm:left-4 sm:bottom-4 sm:max-w-80 sm:p-0",
        !isOpen
          ? "translate-y-8 opacity-0 transition-[opacity,transform]"
          : "translate-y-0 opacity-100 transition-[opacity,transform]",
      )}
    >
      <div className="m-0 rounded-lg border border-border bg-background shadow-lg sm:m-3">
        <div className="flex items-center justify-between border-b border-border p-3">
          <span className="text-sm font-medium">{t("title")}</span>
        </div>
        <div className="p-3">
          <p className="text-xs text-muted-foreground">
            {t("message")}{" "}
            <Link
              href="/privacy-policy"
              className="underline underline-offset-4 hover:text-foreground"
            >
              {t("learnMore")}
            </Link>
          </p>
          <div className="mt-3 grid grid-cols-2 items-center gap-2">
            <Button onClick={accept} size="sm" className="w-full">
              {t("accept")}
            </Button>
            <Button
              onClick={decline}
              variant="ghost"
              size="sm"
              className="w-full"
            >
              {t("decline")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
