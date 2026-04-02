"use client";

import { useEffect } from "react";
import { clientEnv } from "@/lib/env/client";

export function ErudaLoader() {
  useEffect(() => {
    if (clientEnv.NEXT_PUBLIC_ENABLE_ERUDA) {
      // Dynamically import eruda
      import("eruda")
        .then((eruda) => {
          eruda.default.init();
        })
        .catch((error) => {
          console.error("Failed to load eruda:", error);
        });
    }
  }, []);

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
