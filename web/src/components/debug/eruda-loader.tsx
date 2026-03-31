"use client";

import { useEffect } from "react";

export function ErudaLoader() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ENABLE_ERUDA === "true") {
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
