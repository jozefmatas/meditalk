"use client";

import * as React from "react";
import { InputOTPSlot as GeneratedInputOTPSlot } from "@/components/generated/ui/input-otp";
import { cn } from "@/lib/utils";

function InputOTPSlot({
  className,
  ...props
}: React.ComponentProps<typeof GeneratedInputOTPSlot>) {
  return (
    <GeneratedInputOTPSlot className={cn("size-9", className)} {...props} />
  );
}

export { InputOTPSlot };
