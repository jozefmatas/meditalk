"use client";

import * as React from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import {
  SelectContent as GeneratedSelectContent,
  SelectLabel as GeneratedSelectLabel,
} from "@/components/generated/ui/select";

export {
  Select,
  SelectGroup,
  SelectItem,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectValue,
} from "@/components/generated/ui/select";

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof GeneratedSelectLabel>) {
  return (
    <GeneratedSelectLabel
      className={cn("font-medium", className)}
      {...props}
    />
  );
}

export { SelectLabel };

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
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
        className
      )}
      {...props}
    />
  );
}

export { SelectTrigger, SelectContent };
