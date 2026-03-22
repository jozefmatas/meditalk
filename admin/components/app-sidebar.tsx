"use client";

import { usePathname } from "next/navigation";
import {
  LayoutDashboardIcon,
  UsersIcon,
  FileTextIcon,
  LayoutTemplateIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: LayoutDashboardIcon },
  { label: "Users", href: "/users", icon: UsersIcon },
  { label: "Encounters", href: "/encounters", icon: FileTextIcon },
  { label: "Templates", href: "/templates", icon: LayoutTemplateIcon },
];

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();

  return (
    <Sidebar {...props}>
      <SidebarHeader className="border-b border-sidebar-border px-4 h-14 justify-center">
        <span className="text-base font-bold tracking-tight">
          MediTalk Admin
        </span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      render={<a href={item.href} />}
                      isActive={isActive}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
