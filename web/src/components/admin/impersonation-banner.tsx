"use client";

import { useImpersonation } from "./impersonation-context";
import { Button } from "@/components/shared/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";

export function ImpersonationBanner() {
  const { isImpersonating, target, stopImpersonating } = useImpersonation();

  if (!isImpersonating || !target) return null;

  return (
    <div className="mx-2 mb-1 flex items-center justify-between gap-2 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-amber-950 group-data-[collapsible=icon]:hidden">
      <span className="truncate">
        {target.name || target.email || target.id}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-5 shrink-0 gap-1 bg-amber-600/30 px-1.5 text-xs text-amber-950 hover:bg-amber-600/50"
        onClick={stopImpersonating}
      >
        <HugeiconsIcon icon={Cancel01Icon} size={12} />
        Exit
      </Button>
    </div>
  );
}
