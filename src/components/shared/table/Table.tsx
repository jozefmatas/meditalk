"use client";

import * as React from "react";
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead as GeneratedTableHead,
  TableRow,
  TableCell as GeneratedTableCell,
  TableCaption,
} from "@/components/generated/ui/table";
import { cn } from "@/lib/utils";

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <GeneratedTableHead
      className={cn("font-normal text-foreground/65", className)}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <GeneratedTableCell
      className={cn("leading-normal", className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
