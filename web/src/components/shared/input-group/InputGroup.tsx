"use client";

import * as React from "react";
import {
  InputGroup as GeneratedInputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText as GeneratedInputGroupText,
  InputGroupInput as GeneratedInputGroupInput,
  InputGroupTextarea,
} from "@/components/generated/ui/input-group";
import { cn } from "@/lib/utils";

function InputGroup({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof GeneratedInputGroup> & {
  variant?: "default" | "ghost";
}) {
  return (
    <GeneratedInputGroup
      data-variant={variant}
      className={cn(
        "h-9",
        variant === "ghost" &&
          "rounded-none border-0 bg-transparent px-0 shadow-none ring-0 focus-within:ring-0 has-[[data-slot=input-group-control]:focus-visible]:ring-0 **:data-[slot=input-group-addon]:pl-0 **:data-[slot=input-group-addon]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<typeof GeneratedInputGroupInput>) {
  return (
    <GeneratedInputGroupInput
      className={cn("text-sm! placeholder:text-foreground/65!", className)}
      {...props}
    />
  );
}

function InputGroupText({
  className,
  ...props
}: React.ComponentProps<typeof GeneratedInputGroupText>) {
  return (
    <GeneratedInputGroupText
      className={cn("text-foreground/65!", className)}
      {...props}
    />
  );
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
};
