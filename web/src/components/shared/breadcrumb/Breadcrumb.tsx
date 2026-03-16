"use client";

import * as React from "react";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

import { BreadcrumbSeparator as GeneratedBreadcrumbSeparator } from "@/components/generated/ui/breadcrumb";

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
  BreadcrumbEllipsis,
} from "@/components/generated/ui/breadcrumb";

function BreadcrumbSeparator({
  className,
  ...props
}: React.ComponentProps<typeof GeneratedBreadcrumbSeparator>) {
  return (
    <GeneratedBreadcrumbSeparator
      className={cn("text-foreground/65", className)}
      {...props}
    />
  );
}

export { BreadcrumbSeparator };

function BreadcrumbLink({
  asChild,
  className,
  ...props
}: React.ComponentProps<"a"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "a";

  return (
    <Comp
      data-slot="breadcrumb-link"
      className={cn(
        "text-foreground/65 transition-colors hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { BreadcrumbLink };
