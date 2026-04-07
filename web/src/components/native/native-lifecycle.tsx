"use client";

import { useEffect } from "react";
import { isNative } from "@/lib/platform";
import { logger } from "@/lib/logger";

/**
 * Handles Capacitor native lifecycle events:
 * - Hides splash screen on mount
 * - Logs background/foreground transitions
 *
 * Renders nothing — mount in root layout.
 * All imports are dynamic so web bundles stay clean.
 */
export function NativeLifecycle() {
  useEffect(() => {
    if (!isNative) return;

    // Native needs viewport-fit=cover for safe area handling.
    // Added dynamically here (not in static viewport export) because
    // it breaks iOS Safari background audio on mobile web.
    const meta = document.querySelector('meta[name="viewport"]');
    if (meta) {
      const content = meta.getAttribute("content") || "";
      if (!content.includes("viewport-fit=cover")) {
        meta.setAttribute("content", content + ", viewport-fit=cover");
      }
    }

    let cleanup: (() => void) | undefined;

    async function init() {
      // Hide splash screen
      try {
        const { SplashScreen } = await import("@capacitor/splash-screen");
        await SplashScreen.hide();
      } catch (err) {
        logger.warn("[native-lifecycle] SplashScreen.hide failed:", err);
      }

      // Listen for background/foreground transitions
      try {
        const { App } = await import("@capacitor/app");
        const listener = await App.addListener(
          "appStateChange",
          ({ isActive }) => {
            logger.info(
              `[native-lifecycle] App ${isActive ? "foreground" : "background"}`,
            );
          },
        );
        cleanup = () => {
          listener.remove();
        };
      } catch (err) {
        logger.warn("[native-lifecycle] App listener failed:", err);
      }
    }

    init();

    return () => {
      cleanup?.();
    };
  }, []);

  return null;
}
