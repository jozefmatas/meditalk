"use client";

import * as React from "react";
import {
  Button as GeneratedButton,
  buttonVariants,
} from "@/components/generated/ui/button";
import { cn } from "@/lib/utils";

type ButtonProps = React.ComponentProps<typeof GeneratedButton>;

/**
 * Variant-level class overrides applied on top of the generated button.
 * Generated uses `bg-muted` for hover/expanded — we use `bg-accent` instead.
 * Generated default uses `[a]:hover:bg-primary/80` — we use `hover:bg-primary/90`.
 * tailwind-merge ensures these win over the generated classes.
 */
const variantFixes: Partial<Record<string, string>> = {
  default: "hover:bg-primary/90",
  outline:
    "hover:bg-accent aria-expanded:bg-accent",
  ghost:
    "hover:bg-accent aria-expanded:bg-accent dark:hover:bg-accent/50",
};

/** default & lg → size-5 icons; all others → size-4 (overrides generated xs/sm smaller defaults) */
const iconSize5 = "[&_svg:not([class*='size-'])]:size-5";
const iconSize4 = "[&_svg:not([class*='size-'])]:size-4";

function Button({ variant = "default", size = "default", className, ...props }: ButtonProps) {
  const fix = variant ? variantFixes[variant] : undefined;
  const iconFix = size === "default" || size === "lg" || size === "icon" || size === "icon-lg"
    ? iconSize5
    : iconSize4;
  return (
    <GeneratedButton
      variant={variant}
      size={size}
      className={cn(fix, iconFix, className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
