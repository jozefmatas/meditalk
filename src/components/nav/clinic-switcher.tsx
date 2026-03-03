"use client";

import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  StethoscopeIcon,
  ArrowDown01Icon,
  Settings01Icon,
  Logout01Icon,
} from "@hugeicons/core-free-icons";
import { createClient } from "@/lib/supabase/client";
import { routing, type Locale } from "@/i18n/routing";
import { useLocalizedHref } from "@/hooks/use-localized-href";
import { useSidebar } from "@/components/ui/sidebar";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

const localeNames: Record<Locale, string> = {
  sk: "Slovenčina",
  cs: "Čeština",
  en: "English",
};

const localeFlags: Record<Locale, string> = {
  sk: "🇸🇰",
  cs: "🇨🇿",
  en: "🇬🇧",
};

export function ClinicSwitcher() {
  const t = useTranslations("nav");
  const tAuth = useTranslations("auth");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const getHref = useLocalizedHref();
  const { isMobile } = useSidebar();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh();
  };

  const handleLocaleChange = (newLocale: string) => {
    const loc = newLocale as Locale;
    const newPath = loc === routing.defaultLocale ? "/" : `/${loc}`;
    document.cookie = `NEXT_LOCALE=${loc}; path=/; max-age=31536000; SameSite=Lax`;
    router.push(newPath);
    router.refresh();
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <HugeiconsIcon icon={StethoscopeIcon} size={18} />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">MediTalk</span>
              </div>
              <HugeiconsIcon icon={ArrowDown01Icon} size={16} className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuItem asChild>
              <Link href={getHref("/settings")} className="gap-2">
                <HugeiconsIcon icon={Settings01Icon} size={16} />
                {t("settings")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Language</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={locale} onValueChange={handleLocaleChange}>
              {routing.locales.map((loc) => (
                <DropdownMenuRadioItem key={loc} value={loc}>
                  {localeFlags[loc]} {localeNames[loc]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="gap-2">
              <HugeiconsIcon icon={Logout01Icon} size={16} />
              {tAuth("signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
