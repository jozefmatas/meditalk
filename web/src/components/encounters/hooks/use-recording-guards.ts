import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

/** Detect if the device is Android */
function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

export interface UseRecordingGuardsReturn {
  // Navigation guard
  navDialogOpen: boolean;
  closeNavDialog: () => void;
  confirmLeave: () => void;

  // Wake lock
  acquireWakeLock: () => Promise<void>;
  releaseWakeLock: () => void;

  // Notifications
  showRecordingNotification: () => Promise<void>;
  closeRecordingNotification: () => void;
}

/**
 * Hook for managing recording guards that prevent interruptions:
 * - Navigation guard: Prevents accidental tab close or navigation
 * - Wake lock: Keeps screen on during recording
 * - Android notifications: Prevents tab suspension when screen locks
 *
 * @param isRecording - Whether recording is currently active (not idle)
 * @returns Guard management functions and navigation dialog state
 */
export function useRecordingGuards(
  isRecording: boolean,
): UseRecordingGuardsReturn {
  const t = useTranslations("encounters.recording");
  const router = useRouter();

  // Navigation guard state
  const [navDialogOpen, setNavDialogOpen] = useState(false);
  const pendingNavUrlRef = useRef<string | null>(null);

  // Wake lock ref
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // Android notification ref
  const notificationRef = useRef<Notification | null>(null);

  // Wake lock functions
  const acquireWakeLock = useCallback(async () => {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      wakeLockRef.current.addEventListener("release", () => {
        wakeLockRef.current = null;
      });
    } catch {
      // Failed (e.g. low battery, page not visible)
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release();
    wakeLockRef.current = null;
  }, []);

  // Notification functions
  const showRecordingNotification = useCallback(async () => {
    // Only for Android devices with Notification API support
    if (!isAndroid() || !("Notification" in window)) return;

    try {
      // Request permission if not already granted
      if (Notification.permission === "default") {
        await Notification.requestPermission();
      }

      // Create notification if permission granted
      if (Notification.permission === "granted") {
        notificationRef.current = new Notification(
          t("recordingNotificationTitle"),
          {
            body: t("recordingNotificationBody"),
            requireInteraction: true,
            icon: "/icon-192.png",
            badge: "/icon-192.png",
            tag: "meditalk-recording", // Replaces previous notification if any
          },
        );
      }
    } catch (err) {
      // Notification failed — not critical, recording will still work
      console.warn("[notification] Failed to show notification:", err);
    }
  }, [t]);

  const closeRecordingNotification = useCallback(() => {
    if (notificationRef.current) {
      notificationRef.current.close();
      notificationRef.current = null;
    }
  }, []);

  // Navigation guard functions
  const closeNavDialog = useCallback(() => {
    setNavDialogOpen(false);
    pendingNavUrlRef.current = null;
  }, []);

  const confirmLeave = useCallback(() => {
    setNavDialogOpen(false);
    const url = pendingNavUrlRef.current;
    pendingNavUrlRef.current = null;
    if (url) router.push(url);
  }, [router]);

  // Re-acquire wake lock when page becomes visible (OS releases it on hide)
  useEffect(() => {
    const handleVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        isRecording &&
        !wakeLockRef.current
      ) {
        acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [isRecording, acquireWakeLock]);

  // Prevent accidental navigation while recording is active
  useEffect(() => {
    if (!isRecording) return;

    // Tab close / page refresh — browser shows native "Leave site?" dialog
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    // Client-side link clicks — show our custom dialog instead of navigating
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as Element).closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href === "#") return;
      try {
        const url = new URL(href, location.origin);
        if (
          url.origin === location.origin &&
          url.pathname !== location.pathname
        ) {
          e.preventDefault();
          e.stopPropagation();
          pendingNavUrlRef.current = href;
          setNavDialogOpen(true);
        }
      } catch {
        // invalid URL, ignore
      }
    };
    document.addEventListener("click", handleClick, true);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleClick, true);
    };
  }, [isRecording]);

  return {
    navDialogOpen,
    closeNavDialog,
    confirmLeave,
    acquireWakeLock,
    releaseWakeLock,
    showRecordingNotification,
    closeRecordingNotification,
  };
}
