"use client";

import { SidebarProvider, SidebarInset } from "@/components/shared/sidebar";
import { TooltipProvider } from "@/components/shared/tooltip";
import { cn } from "@/lib/utils";
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
        <SidebarInset className="max-h-svh overflow-hidden">
          <Header />
          <div
            className={cn(
              contentClassName ?? "flex-1 overflow-y-auto p-6",
              "pb-safe",
            )}
          >
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
