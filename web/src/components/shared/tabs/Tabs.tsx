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
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
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
        variant === "line" && "group-data-horizontal/tabs:h-10 h-10",
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
        "font-normal text-foreground/65 hover:text-foreground data-active:font-medium",
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
  /** Called when user removes a tab via the x button */
  onRemoveTab?: (value: string) => void;
  /** Tab values that can be removed (show x icon) */
  removableTabs?: string[];
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
  onRemoveTab,
  removableTabs = [],
  actionLabel = "Add document",
  children,
  className,
}: TabsLineWithActionProps) {
  // Only show tabs in dropdown that aren't already visible
  const hiddenTabs = availableTabs.filter(
    (opt) => !tabs.some((t) => t.value === opt.value),
  );

  return (
    <Tabs
      value={value}
      onValueChange={onValueChange}
      className={cn("gap-6", className)}
    >
      <div className="flex items-center gap-1 border-b border-border">
        <TabsList variant="line">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
              {removableTabs.includes(tab.value) && onRemoveTab && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveTab(tab.value);
                  }}
                  className="ml-1 rounded-sm opacity-50 hover:opacity-100"
                >
                  <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
                </button>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {hiddenTabs.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="text-foreground/65 hover:text-foreground"
              >
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
