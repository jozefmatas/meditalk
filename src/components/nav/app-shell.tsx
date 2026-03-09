"use client";

import { SidebarProvider, SidebarInset } from "@/components/shared/sidebar";
import { TooltipProvider } from "@/components/shared/tooltip";
import { PageTitleProvider } from "./page-title-context";
import { AppSidebar } from "./app-sidebar";
import { Header } from "./header";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <TooltipProvider>
      <PageTitleProvider>
        <SidebarProvider className="bg-sidebar">
          <AppSidebar />
          <SidebarInset className="rounded-l-3xl">
            <Header />
            <div className="flex-1 overflow-y-auto p-6">{children}</div>
          </SidebarInset>
        </SidebarProvider>
      </PageTitleProvider>
    </TooltipProvider>
  );
}
