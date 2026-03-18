"use client";

import { Toaster as GeneratedToaster } from "@/components/generated/ui/sonner";
import type { ComponentProps } from "react";

type ToasterProps = ComponentProps<typeof GeneratedToaster>;

function Toaster(props: ToasterProps) {
  return <GeneratedToaster {...props} />;
}

export { Toaster };
