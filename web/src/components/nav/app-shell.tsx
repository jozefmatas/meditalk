"use client";

import { SidebarProvider, SidebarInset } from "@/components/shared/sidebar";
import { TooltipProvider } from "@/components/shared/tooltip";
import { AppSidebar } from "./app-sidebar";
import { Header } from "./header";

interface AppShellProps {
  children: React.ReactNode;
  /** Override the default content wrapper classes (default: "flex-1 overflow-y-auto p-6") */
  contentClassName?: string;
}

export function AppShell({ children, contentClassName }: AppShellProps) {
  return (
    <TooltipProvider>
      <SidebarProvider className="bg-sidebar">
        <AppSidebar />
        <SidebarInset className="max-h-svh overflow-hidden rounded-l-3xl">
          <Header />
          <div className={contentClassName ?? "flex-1 overflow-y-auto p-6"}>
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
