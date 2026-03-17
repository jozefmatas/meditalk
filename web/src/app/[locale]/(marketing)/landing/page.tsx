import { useTranslations } from "next-intl";

export default function LandingPage() {
  const t = useTranslations("marketing.hero");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";

  return (
    <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
      <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
        {t("title")}
      </h1>
      <p className="mt-6 max-w-xl text-lg text-foreground/65">
        {t("subtitle")}
      </p>
      <a
        href={appUrl ? `${appUrl}/login` : "/login"}
        className="mt-10 inline-flex h-12 items-center rounded-xl bg-primary px-8 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        {t("cta")}
      </a>
    </div>
  );
}
