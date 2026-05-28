import { useTranslations } from "next-intl";
import { UnicornHeroScene } from "@/components/landing/unicorn-hero-scene";
import { clientEnv } from "@/lib/env/client";

export default function LandingPage() {
  const t = useTranslations("marketing.hero");
  const appUrl = clientEnv.NEXT_PUBLIC_APP_URL;

  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden bg-accent px-6">
      <div className="absolute inset-0 z-0">
        <UnicornHeroScene />
      </div>

      <div className="relative z-10 flex max-w-3xl flex-col items-center text-center">
        <span className="inline-flex items-center rounded-full bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary sm:text-sm">
          {t("eyebrow")}
        </span>

        <h1 className="mt-5 max-w-md text-5xl font-light tracking-tight text-foreground sm:max-w-2xl sm:text-7xl">
          {t("titleLead")}{" "}
          <span className="font-serif font-semibold italic text-primary">
            {t("titleEmphasis")}
          </span>
        </h1>

        <p className="mt-5 max-w-xl text-base text-foreground/65 sm:text-lg">
          {t("subtitle")}
        </p>

        <a
          href={appUrl ? `${appUrl}/login` : "/login"}
          className="mt-6 inline-flex h-12 items-center rounded-2xl bg-secondary px-6 text-lg font-medium text-secondary-foreground transition-colors hover:bg-secondary/90"
        >
          {t("cta")}
        </a>
      </div>
    </section>
  );
}
