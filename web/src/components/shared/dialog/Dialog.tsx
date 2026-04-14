"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { DialogContent as GeneratedDialogContent } from "@/components/generated/ui/dialog";

export {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "@/components/generated/ui/dialog";

function DialogContent({
  "aria-describedby": ariaDescribedBy,
  ...props
}: React.ComponentProps<typeof GeneratedDialogContent>) {
  return (
    <GeneratedDialogContent
      aria-describedby={ariaDescribedBy ?? undefined}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-foreground/65 *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { DialogContent, DialogDescription };
