"use client";

import { useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import { ClinicSwitcher } from "./clinic-switcher";
import { NavMain } from "./nav-main";
import { NavVisits } from "./nav-visits";
import { SearchCommand } from "./search-command";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      <Sidebar collapsible="icon" {...props}>
        <SidebarHeader>
          <ClinicSwitcher />
        </SidebarHeader>
        <SidebarContent>
          <NavMain onSearchClick={() => setSearchOpen(true)} />
          <NavVisits />
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
      <SearchCommand open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
