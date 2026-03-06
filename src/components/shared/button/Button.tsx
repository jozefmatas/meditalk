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

function Button({ variant = "default", className, ...props }: ButtonProps) {
  const fix = variant ? variantFixes[variant] : undefined;
  return (
    <GeneratedButton
      variant={variant}
      className={cn(fix, className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
