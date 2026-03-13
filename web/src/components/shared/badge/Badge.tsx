"use client";

import * as React from "react";
import {
  Badge as GeneratedBadge,
  badgeVariants,
} from "@/components/generated/ui/badge";
import { cn } from "@/lib/utils";

type BadgeProps = React.ComponentProps<typeof GeneratedBadge>;

/** Variant-level class overrides applied on top of the generated badge. */
const variantFixes: Partial<Record<string, string>> = {
  link: "no-underline bg-foreground text-background cursor-pointer hover:bg-foreground/80 hover:no-underline",
};

/**
 * Status-specific class overrides layered on the "default" base variant.
 * Uses CSS variable colors from globals.css: --color-status-*.
 */
const statusClasses: Record<string, string> = {
  "status-started": "bg-muted text-foreground/65",
  "status-recording": "bg-destructive/10 text-destructive",
  "status-processing": "bg-status-processing/10 text-status-processing",
  "status-to_review": "bg-status-to_review/10 text-status-to_review",
  "status-completed": "bg-status-completed/10 text-status-completed",
  "status-archived": "bg-status-archived/10 text-status-archived",
};

type StatusVariant = keyof typeof statusClasses;

type ExtendedBadgeProps = Omit<BadgeProps, "variant"> & {
  variant?: BadgeProps["variant"] | StatusVariant;
};

function Badge({
  variant = "default",
  className,
  ...props
}: ExtendedBadgeProps) {
  const statusFix = variant ? statusClasses[variant] : undefined;
  const variantFix = variant ? variantFixes[variant] : undefined;

  // Status variants render as the "default" base with color overrides
  const baseVariant = statusFix
    ? "default"
    : (variant as BadgeProps["variant"]);

  return (
    <GeneratedBadge
      variant={baseVariant}
      className={cn("rounded-sm", variantFix, statusFix, className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
export type { ExtendedBadgeProps as BadgeProps, StatusVariant };
