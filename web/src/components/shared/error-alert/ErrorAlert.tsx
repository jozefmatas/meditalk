"use client";

import { Alert, AlertDescription } from "@/components/shared/alert";
import { HugeiconsIcon } from "@hugeicons/react";
import { AlertCircleIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

interface ErrorAlertProps {
  message: string;
  className?: string;
}

export function ErrorAlert({ message, className }: ErrorAlertProps) {
  return (
    <Alert
      variant="destructive"
      className={cn("border-none bg-destructive/10", className)}
    >
      <HugeiconsIcon icon={AlertCircleIcon} size={16} />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
