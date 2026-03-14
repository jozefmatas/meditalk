"use client";

import * as React from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import {
  SelectContent as GeneratedSelectContent,
  SelectItem as GeneratedSelectItem,
  SelectLabel as GeneratedSelectLabel,
} from "@/components/generated/ui/select";

export {
  Select,
  SelectGroup,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectValue,
} from "@/components/generated/ui/select";

function SelectItem({
  className,
  ...props
}: React.ComponentProps<typeof GeneratedSelectItem>) {
  return (
    <GeneratedSelectItem
      className={cn("cursor-pointer", className)}
      {...props}
    />
  );
}

export { SelectItem };

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof GeneratedSelectLabel>) {
  return (
    <GeneratedSelectLabel className={cn("font-medium", className)} {...props} />
  );
}

export { SelectLabel };

const triggerVariants: Record<string, string> = {
  default: "border-input bg-background dark:bg-input/30 dark:hover:bg-input/50",
  ghost: "border-transparent bg-transparent shadow-none dark:bg-transparent",
};

function SelectTrigger({
  className,
  size = "default",
  variant = "default",
  label,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default";
  variant?: "default" | "ghost";
  /** Prefix label rendered before the value, e.g. "Template" → "Template: Value" */
  label?: string;
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit min-w-0 overflow-hidden items-center justify-between gap-1.5 rounded-lg border py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none hover:bg-accent hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-9 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        triggerVariants[variant],
        className,
      )}
      {...props}
    >
      {label ? (
        <span className="flex min-w-0 items-center gap-0.5">
          <span className="text-foreground/65 shrink-0">{label}:</span>
          {children}
        </span>
      ) : (
        children
      )}
      <SelectPrimitive.Icon asChild>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className="pointer-events-none size-4 text-foreground/65"
        />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  position = "popper",
  ...props
}: React.ComponentProps<typeof GeneratedSelectContent>) {
  return (
    <GeneratedSelectContent
      position={position}
      className={cn(
        "p-1 min-w-(--radix-select-trigger-width) data-[state=closed]:overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}

export { SelectTrigger, SelectContent };
