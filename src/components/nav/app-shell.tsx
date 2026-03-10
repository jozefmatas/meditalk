"use client";

import { SidebarProvider, SidebarInset } from "@/components/shared/sidebar";
import { TooltipProvider } from "@/components/shared/tooltip";
import { AppSidebar } from "./app-sidebar";
import { Header } from "./header";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <TooltipProvider>
      <SidebarProvider className="bg-sidebar">
        <AppSidebar />
        <SidebarInset className="rounded-l-3xl">
          <Header />
          <div className="flex-1 overflow-y-auto p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
