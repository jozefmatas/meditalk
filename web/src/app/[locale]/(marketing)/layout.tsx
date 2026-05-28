import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { CookieConsent } from "@/components/shared/cookie-consent";
import { MeditalkLogo } from "@/components/nav/meditalk-logo";
import { clientEnv } from "@/lib/env/client";

function MarketingNav() {
  const t = useTranslations("marketing.nav");
  const appUrl = clientEnv.NEXT_PUBLIC_APP_URL;

  return (
    <header className="absolute inset-x-0 top-0 z-20">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link
          href="/landing"
          className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground"
        >
          <MeditalkLogo className="text-primary h-8 w-8" />
          <span className="text-lg font-normal">MediTalk</span>
        </Link>
        <a
          href={appUrl ? `${appUrl}/login` : "/login"}
          className="inline-flex h-9 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t("startFree")}
        </a>
      </div>
    </header>
  );
}

function MarketingFooter() {
  const t = useTranslations("marketing.footer");

  return (
    <footer className="relative z-10 border-t border-border/60 bg-accent">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <p className="text-sm text-foreground/65">
          {t("copyright", { year: new Date().getFullYear() })}
        </p>
        <div className="flex items-center gap-6">
          <Link
            href="/privacy-policy"
            className="text-sm text-foreground/65 transition-colors hover:text-foreground"
          >
            {t("privacyPolicy")}
          </Link>
          <Link
            href="/terms-of-service"
            className="text-sm text-foreground/65 transition-colors hover:text-foreground"
          >
            {t("termsOfService")}
          </Link>
        </div>
      </div>
    </footer>
  );
}

export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="relative flex min-h-screen flex-col bg-accent">
      <MarketingNav />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
      <CookieConsent />
    </div>
  );
}
