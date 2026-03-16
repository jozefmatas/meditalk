"use client";

import * as React from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText as GeneratedInputGroupText,
  InputGroupInput as GeneratedInputGroupInput,
  InputGroupTextarea,
} from "@/components/generated/ui/input-group";
import { cn } from "@/lib/utils";

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<typeof GeneratedInputGroupInput>) {
  return (
    <GeneratedInputGroupInput
      className={cn("placeholder:text-foreground/65!", className)}
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
