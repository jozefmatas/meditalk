"use client";

import { useEffect } from "react";
import { clientEnv } from "@/lib/env/client";
import { useIsAdmin } from "@/hooks/use-is-admin";

export function ErudaLoader() {
  const isAdmin = useIsAdmin();

  useEffect(() => {
    if (clientEnv.NEXT_PUBLIC_ENABLE_ERUDA && isAdmin) {
      import("eruda")
        .then((eruda) => {
          eruda.default.init();
        })
        .catch((error) => {
          console.error("Failed to load eruda:", error);
        });
    }
  }, [isAdmin]);

  return null;
}

// Type declaration for eruda
declare global {
  interface Window {
    eruda?: {
      init: () => void;
    };
  }
}
