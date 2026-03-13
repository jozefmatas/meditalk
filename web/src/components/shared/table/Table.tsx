"use client";

import * as React from "react";
import {
  Table as GeneratedTable,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead as GeneratedTableHead,
  TableRow,
  TableCell as GeneratedTableCell,
  TableCaption,
} from "@/components/generated/ui/table";
import { cn } from "@/lib/utils";

interface TableProps extends React.ComponentProps<"table"> {
  variant?: "default" | "compact";
}

function Table({ className, variant = "default", ...props }: TableProps) {
  return (
    <GeneratedTable
      className={cn(
        variant === "compact" &&
          "table-fixed text-xs **:data-[slot=table-cell]:px-1! **:data-[slot=table-cell]:py-2! **:data-[slot=table-cell]:overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}

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
