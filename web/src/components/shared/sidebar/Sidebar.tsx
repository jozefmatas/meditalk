"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { useSidebar } from "@/components/generated/ui/sidebar";
import { Button } from "@/components/shared/button";
import { cn } from "@/lib/utils";

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/generated/ui/sidebar";

function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar();

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-lg"
      className={cn(className)}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      <HugeiconsIcon icon={SidebarLeftIcon} />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
}

export { SidebarTrigger };
