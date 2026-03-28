"use client";

import * as React from "react";
import {
  Accordion,
  AccordionItem as GeneratedAccordionItem,
  AccordionTrigger as GeneratedAccordionTrigger,
  AccordionContent,
} from "@/components/generated/ui/accordion";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  AccordionItem with variant                                         */
/* ------------------------------------------------------------------ */

type GeneratedItemProps = React.ComponentProps<typeof GeneratedAccordionItem>;

interface AccordionItemProps extends GeneratedItemProps {
  variant?: "default" | "bordered";
}

function AccordionItem({
  variant = "default",
  className,
  ...props
}: AccordionItemProps) {
  return (
    <GeneratedAccordionItem
      className={cn(
        variant === "bordered" &&
          "rounded-lg border border-border not-last:border-b **:data-[slot=accordion-trigger]:px-4 **:data-[slot=accordion-trigger]:hover:bg-accent/50 **:data-[slot=accordion-content]:px-4",
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  AccordionTrigger with optional icon                                */
/* ------------------------------------------------------------------ */

type GeneratedTriggerProps = React.ComponentProps<
  typeof GeneratedAccordionTrigger
>;

interface AccordionTriggerProps extends GeneratedTriggerProps {
  icon?: IconSvgElement;
}

function AccordionTrigger({
  icon,
  className,
  children,
  ...props
}: AccordionTriggerProps) {
  return (
    <GeneratedAccordionTrigger
      className={cn(
        "items-center hover:no-underline **:data-[slot=accordion-trigger-icon]:text-foreground/65",
        className,
      )}
      {...props}
    >
      {icon && <HugeiconsIcon icon={icon} className="mr-2 size-5 shrink-0" />}
      {children}
    </GeneratedAccordionTrigger>
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
