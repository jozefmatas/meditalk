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
  ...props
}: React.ComponentProps<typeof GeneratedInputGroup>) {
  return <GeneratedInputGroup className={cn("h-9", className)} {...props} />;
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
