"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter as useNextRouter } from "next/navigation";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  Settings01Icon,
  Logout01Icon,
} from "@hugeicons/core-free-icons";
import { createClient } from "@/lib/supabase/client";
import { routing, type Locale } from "@/i18n/routing";
import { useRouter, usePathname } from "@/i18n/navigation";
import { useLocalizedHref } from "@/hooks/use-localized-href";
import { useSidebar } from "@/components/shared/sidebar";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/shared/sidebar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/shared/dropdown-menu";

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
  const nextRouter = useNextRouter();
  const intlRouter = useRouter();
  const pathname = usePathname();
  const getHref = useLocalizedHref();
  const { isMobile } = useSidebar();
  const [userName, setUserName] = useState<string>("...");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      const user = data.user;
      const name =
        user?.user_metadata?.full_name ||
        user?.user_metadata?.name ||
        user?.email?.split("@")[0] ||
        "User";
      setUserName(name);
    });
  }, []);

  const initial = userName !== "..." ? userName[0].toUpperCase() : "?";

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    nextRouter.refresh();
  };

  const handleLocaleChange = (newLocale: string) => {
    intlRouter.replace(pathname, { locale: newLocale as Locale });
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {/* Figma footer: flex gap-2 (8px), items-center, no internal padding.
                size="lg" keeps collapsed-icon behavior; h-auto + p-0 matches Figma sizing.
                Avatar 32px centers at 24px from edge, matching nav icon centers. */}
            <SidebarMenuButton
              size="lg"
              className="h-auto gap-2 rounded-none p-2 [&_svg]:size-5 data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground group-data-[collapsible=icon]:w-full! group-data-[collapsible=icon]:h-auto! group-data-[collapsible=icon]:px-2! group-data-[collapsible=icon]:py-2!"
            >
              {/* Figma: size-8 (32px), rounded-lg, border border-sidebar-border, bg-background */}
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-sidebar-border bg-background text-sm text-sidebar-foreground">
                {initial}
              </div>
              {/* Figma: flex-col, flex-1, h-[30px], justify-between, leading-tight */}
              <div className="flex flex-1 flex-col gap-1 overflow-hidden">
                <span className="truncate text-sm leading-none text-sidebar-foreground">
                  {userName}
                </span>
                <span className="truncate text-xs leading-none text-sidebar-foreground/65">
                  MediTalk
                </span>
              </div>
              {/* Figma: 20×20 arrow icon */}
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                size={20}
                className="shrink-0 text-sidebar-foreground"
              />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="mb-2 w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            align="end"
            side={isMobile ? "top" : "right"}
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
            <DropdownMenuRadioGroup
              value={locale}
              onValueChange={handleLocaleChange}
            >
              {routing.locales.map((loc) => (
                <DropdownMenuRadioItem key={loc} value={loc}>
                  {localeFlags[loc]} {localeNames[loc]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={handleSignOut}
              className="gap-2"
            >
              <HugeiconsIcon icon={Logout01Icon} size={16} />
              {tAuth("signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
