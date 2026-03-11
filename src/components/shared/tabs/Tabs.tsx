"use client";

import * as React from "react";
import {
  Tabs as TabsBase,
  TabsList as TabsListBase,
  TabsTrigger as TabsTriggerBase,
  TabsContent as TabsContentBase,
  tabsListVariants,
} from "@/components/generated/ui/tabs";
import { Button } from "@/components/shared/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/shared/dropdown-menu";
import { cn } from "@/lib/utils";

/* ── Re-export base components with style overrides ── */

const Tabs = TabsBase;

function TabsList({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof TabsListBase>) {
  return (
    <TabsListBase
      variant={variant}
      className={cn(
        variant === "line" && "h-9",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsTriggerBase>) {
  return (
    <TabsTriggerBase
      className={cn(
        "text-foreground/65 hover:text-foreground",
        "group-data-[variant=line]/tabs-list:data-active:text-primary group-data-[variant=line]/tabs-list:after:bg-primary",
        className,
      )}
      {...props}
    />
  );
}

const TabsContent = TabsContentBase;

/* ── Composite: Line tabs with a "+" dropdown action ── */

interface TabOption {
  value: string;
  label: string;
}

interface TabsLineWithActionProps {
  /** Currently visible tabs */
  tabs: TabOption[];
  /** All available tabs that can be added via the dropdown */
  availableTabs: TabOption[];
  /** Current active tab value */
  value: string;
  onValueChange: (value: string) => void;
  /** Called when user picks a tab from the dropdown */
  onAddTab: (value: string) => void;
  /** Label for the action button (e.g. "Add document") */
  actionLabel?: string;
  children?: React.ReactNode;
  className?: string;
}

function TabsLineWithAction({
  tabs,
  availableTabs,
  value,
  onValueChange,
  onAddTab,
  actionLabel = "Add document",
  children,
  className,
}: TabsLineWithActionProps) {
  // Only show tabs in dropdown that aren't already visible
  const hiddenTabs = availableTabs.filter(
    (opt) => !tabs.some((t) => t.value === opt.value),
  );

  return (
    <Tabs value={value} onValueChange={onValueChange} className={className}>
      <div className="flex items-center gap-2">
        <TabsList variant="line" className="h-9">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {hiddenTabs.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="text-foreground/65 hover:text-foreground">
                + {actionLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {hiddenTabs.map((tab) => (
                <DropdownMenuItem
                  key={tab.value}
                  onClick={() => onAddTab(tab.value)}
                >
                  {tab.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {children}
    </Tabs>
  );
}

export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  TabsLineWithAction,
  tabsListVariants,
};
export type { TabOption, TabsLineWithActionProps };
