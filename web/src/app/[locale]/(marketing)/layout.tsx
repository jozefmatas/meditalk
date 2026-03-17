import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

function MarketingNav() {
  const t = useTranslations("marketing.nav");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <Link href="/" className="text-xl font-bold">
          MediTalk
        </Link>
        <nav className="flex items-center gap-6">
          <a
            href={appUrl ? `${appUrl}/login` : "/login"}
            className="text-sm font-medium text-foreground/65 transition-colors hover:text-foreground"
          >
            {t("login")}
          </a>
        </nav>
      </div>
    </header>
  );
}

function MarketingFooter() {
  const t = useTranslations("marketing.footer");

  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto flex h-16 max-w-5xl items-center px-6">
        <p className="text-sm text-foreground/65">
          {t("copyright", { year: new Date().getFullYear() })}
        </p>
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
    <div className="flex min-h-screen flex-col">
      <MarketingNav />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  );
}
