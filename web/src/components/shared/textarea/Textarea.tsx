"use client";

import * as React from "react";
import { Textarea as GeneratedTextarea } from "@/components/generated/ui/textarea";
import { cn } from "@/lib/utils";

function Textarea({
  className,
  ...props
}: React.ComponentProps<typeof GeneratedTextarea>) {
  return (
    <GeneratedTextarea
      className={cn("text-sm placeholder:text-foreground/65", className)}
      {...props}
    />
  );
}

export { Textarea };
