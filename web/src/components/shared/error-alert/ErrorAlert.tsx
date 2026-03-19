"use client";

import { Alert, AlertDescription } from "@/components/shared/alert";
import { Button } from "@/components/shared/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { AlertCircleIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

interface ErrorAlertProps {
  message: string;
  className?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorAlert({
  message,
  className,
  onRetry,
  retryLabel,
}: ErrorAlertProps) {
  return (
    <Alert
      variant="destructive"
      className={cn("border-none bg-destructive/10", className)}
    >
      <HugeiconsIcon icon={AlertCircleIcon} size={16} />
      <AlertDescription className="flex items-center justify-between gap-4">
        <span>{message}</span>
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="shrink-0"
          >
            {retryLabel || "Retry"}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
