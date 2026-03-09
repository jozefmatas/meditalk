"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MeditalkLogo } from "./meditalk-logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
} from "@/components/shared/sidebar";
import { ClinicSwitcher } from "./clinic-switcher";
import { NavMain } from "./nav-main";
import { NavVisits } from "./nav-visits";
import { SearchCommand } from "./search-command";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [searchOpen, setSearchOpen] = useState(false);
  const tCommon = useTranslations("common");

  return (
    <>
      <Sidebar collapsible="icon" className="group-data-[side=left]:border-r-0" {...props}>
        {/* Figma node 100:1619 — entire content area has p-2, sidebar root has 0 padding */}
        <SidebarContent className="gap-0 overflow-hidden p-2">
          {/* Brand + nav — sticky top, never scrolls */}
          <div className="flex shrink-0 flex-col gap-3 pb-6">
            <div className="flex h-9 items-center">
              <div className="flex size-8 shrink-0 items-center justify-center">
                <MeditalkLogo className="text-primary" />
              </div>
              <span className="truncate text-sm text-sidebar-foreground group-data-[collapsible=icon]:hidden">
                {tCommon("appName")}
              </span>
            </div>
            <NavMain onSearchClick={() => setSearchOpen(true)} />
          </div>
          {/* Latest visits — scrolls independently */}
          <NavVisits />
        </SidebarContent>

        {/* Figma node 100:1690 — footer has p-2 */}
        <SidebarFooter className="p-0">
          <ClinicSwitcher />
        </SidebarFooter>

      </Sidebar>
      <SearchCommand open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
