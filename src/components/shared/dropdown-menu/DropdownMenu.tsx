"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  DropdownMenuContent as GeneratedDropdownMenuContent,
} from "@/components/generated/ui/dropdown-menu";

/**
 * Wrapper around the generated DropdownMenuContent.
 * Removes the default `w-(--radix-dropdown-menu-trigger-width)` so the
 * dropdown sizes to its content. Pass `w-[--radix-dropdown-menu-trigger-width]`
 * via className if you need trigger-width matching.
 */
function DropdownMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof GeneratedDropdownMenuContent>) {
  return (
    <GeneratedDropdownMenuContent
      className={cn("w-auto", className)}
      {...props}
    />
  );
}

export { DropdownMenuContent };

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/generated/ui/dropdown-menu";
