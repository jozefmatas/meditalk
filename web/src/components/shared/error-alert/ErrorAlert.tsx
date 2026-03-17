"use client";

import { Alert, AlertDescription } from "@/components/shared/alert";
import { HugeiconsIcon } from "@hugeicons/react";
import { AlertCircleIcon } from "@hugeicons/core-free-icons";

interface ErrorAlertProps {
  message: string;
  className?: string;
}

export function ErrorAlert({ message, className }: ErrorAlertProps) {
  return (
    <Alert variant="destructive" className={className}>
      <HugeiconsIcon icon={AlertCircleIcon} size={16} />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
