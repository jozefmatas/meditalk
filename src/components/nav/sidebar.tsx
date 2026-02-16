"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Home01Icon,
  Add01Icon,
  Settings01Icon,
  Logout01Icon,
  StethoscopeIcon,
} from "@hugeicons/core-free-icons";

interface NavItem {
  href: string;
  labelKey: string;
  icon: typeof Home01Icon;
}

const navItems: NavItem[] = [
  { href: "", labelKey: "dashboard", icon: Home01Icon },
  { href: "/visits/new", labelKey: "newVisit", icon: Add01Icon },
  { href: "/settings", labelKey: "settings", icon: Settings01Icon },
];

export function Sidebar() {
  const t = useTranslations("nav");
  const tAuth = useTranslations("auth");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh();
  };

  const getLocalizedHref = (href: string) => {
    const base = locale === "sk" ? "" : `/${locale}`;
    return `${base}${href}` || "/";
  };

  const isActive = (href: string) => {
    const localizedHref = getLocalizedHref(href);
    if (href === "") {
      // Dashboard is active only on exact match
      return pathname === localizedHref || pathname === `/${locale}`;
    }
    return pathname.startsWith(localizedHref);
  };

  return (
    <aside className="flex h-screen w-64 flex-col border-r bg-card">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
          <HugeiconsIcon icon={StethoscopeIcon} size={18} className="text-primary-foreground" />
        </div>
        <span className="text-lg font-semibold">MediTalk</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={getLocalizedHref(item.href)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <HugeiconsIcon icon={item.icon} size={18} />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t p-3 space-y-2">
        <LanguageSwitcher />
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={handleSignOut}
        >
          <HugeiconsIcon icon={Logout01Icon} size={16} />
          {tAuth("signOut")}
        </Button>
      </div>
    </aside>
  );
}
