"use client";

import * as React from "react";
import { Input as GeneratedInput } from "@/components/generated/ui/input";
import { cn } from "@/lib/utils";

function Input({
  className,
  ...props
}: React.ComponentProps<typeof GeneratedInput>) {
  return (
    <GeneratedInput
      className={cn("h-9 text-sm! placeholder:text-foreground/65!", className)}
      {...props}
    />
  );
}

export { Input };
