import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { logger } from "@/lib/logger";
import { isNative } from "@/lib/platform";
import {
  nativeStartRecordingService,
  nativeStopRecordingService,
} from "@/lib/native-guards";

/** Detect Android browser (NOT native) for web notification guard. */
function isAndroidBrowser(): boolean {
  return !isNative && /Android/i.test(navigator.userAgent);
}

export interface UseRecordingGuardsReturn {
  // Navigation guard
  navDialogOpen: boolean;
  closeNavDialog: () => void;
  confirmLeave: () => Promise<void>;

  // Wake lock / foreground service
  acquireWakeLock: () => Promise<void>;
  releaseWakeLock: () => void;

  // Notifications
  showRecordingNotification: () => Promise<void>;
  closeRecordingNotification: () => void;

  // Audio interruption (phone calls)
  audioInterrupted: boolean;
  setAudioContext: (ctx: AudioContext | null) => void;
}

/**
 * Hook for managing recording guards that prevent interruptions:
 * - Navigation guard: Prevents accidental tab close or navigation
 * - Wake lock (web) / Foreground service (Android): Keeps recording alive
 * - Android notifications (web): Prevents tab suspension when screen locks
 * - Audio interruption detection: Auto-detects phone call interruptions
 *
 * @param shouldBlockNavigation - Whether navigation should be intercepted.
 *   Typically `true` only when actively recording, NOT when paused (session
 *   is already persisted when paused, so no data loss on navigation).
 * @param onBeforeLeave - Optional async callback invoked before confirming
 *   navigation (e.g. auto-pause + persist session).
 * @returns Guard management functions and navigation dialog state
 */
export function useRecordingGuards(
  shouldBlockNavigation: boolean,
  onBeforeLeave?: () => Promise<void>,
): UseRecordingGuardsReturn {
  const t = useTranslations("encounters.detail");
  const router = useRouter();

  // Navigation guard state
  const [navDialogOpen, setNavDialogOpen] = useState(false);
  const pendingNavUrlRef = useRef<string | null>(null);

  // Wake lock ref (web only)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // Android notification ref (web only)
  const notificationRef = useRef<Notification | null>(null);

  // Keep onBeforeLeave in a ref so the beforeunload handler always has the
  // latest closure (with fresh duration, upload state, etc.)
  const onBeforeLeaveRef = useRef(onBeforeLeave);
  useEffect(() => {
    onBeforeLeaveRef.current = onBeforeLeave;
  });

  // Audio interruption state (phone call detection)
  const [audioInterrupted, setAudioInterrupted] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  const setAudioContext = useCallback((ctx: AudioContext | null) => {
    audioContextRef.current = ctx;
  }, []);

  // Wake lock / foreground service functions
  const acquireWakeLock = useCallback(async () => {
    if (isNative) {
      // Android: start foreground service (keeps WebView + mic alive on lock)
      // iOS: no-op here — UIBackgroundModes:audio handles it at OS level
      await nativeStartRecordingService(
        t("recordingNotificationTitle"),
        t("recordingNotificationBody"),
      );
      return;
    }

    // Web: existing Wake Lock API
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      wakeLockRef.current.addEventListener("release", () => {
        wakeLockRef.current = null;
      });
    } catch {
      // Failed (e.g. low battery, page not visible)
    }
  }, [t]);

  const releaseWakeLock = useCallback(() => {
    if (isNative) {
      // Android: stop foreground service. iOS: no-op
      nativeStopRecordingService();
      return;
    }

    // Web: existing release
    wakeLockRef.current?.release();
    wakeLockRef.current = null;
  }, []);

  // Notification functions
  const showRecordingNotification = useCallback(async () => {
    // Native: no-op — Android foreground service already shows notification
    if (isNative) return;

    // Web: Only for Android browser devices with Notification API support
    if (!isAndroidBrowser() || !("Notification" in window)) return;

    try {
      if (Notification.permission === "default") {
        await Notification.requestPermission();
      }

      if (Notification.permission === "granted") {
        notificationRef.current = new Notification(
          t("recordingNotificationTitle"),
          {
            body: t("recordingNotificationBody"),
            requireInteraction: true,
            icon: "/icon-192.png",
            badge: "/icon-192.png",
            tag: "meditalk-recording",
          },
        );
      }
    } catch (err) {
      logger.warn("[notification] Failed to show notification:", err);
    }
  }, [t]);

  const closeRecordingNotification = useCallback(() => {
    // Native: no-op
    if (isNative) return;

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

  const confirmLeave = useCallback(async () => {
    setNavDialogOpen(false);
    const url = pendingNavUrlRef.current;
    pendingNavUrlRef.current = null;
    // Auto-pause + persist before navigating (e.g. pause recorder, upload segment)
    if (onBeforeLeave) await onBeforeLeave();
    if (url) router.push(url);
  }, [router, onBeforeLeave]);

  // Re-acquire wake lock when page becomes visible (web only — OS releases it on hide)
  // Native: UIBackgroundModes (iOS) + foreground service (Android) persist
  useEffect(() => {
    if (isNative) return;

    const handleVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        shouldBlockNavigation &&
        !wakeLockRef.current
      ) {
        acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [shouldBlockNavigation, acquireWakeLock]);

  // Detect phone call interruptions via AudioContext state changes.
  // iOS: AudioContext transitions to "interrupted" → "running" after call.
  // Android: AudioContext transitions to "suspended" → "running".
  useEffect(() => {
    const ctx = audioContextRef.current;
    if (!ctx || !shouldBlockNavigation) return;

    const handleStateChange = () => {
      if (ctx.state === "interrupted" || ctx.state === "suspended") {
        setAudioInterrupted(true);
        logger.info("[recording-guards] Audio interrupted (phone call?)");
      } else if (ctx.state === "running") {
        setAudioInterrupted(false);
        logger.info("[recording-guards] Audio resumed after interruption");
      }
    };

    ctx.addEventListener("statechange", handleStateChange);
    return () => ctx.removeEventListener("statechange", handleStateChange);
  }, [shouldBlockNavigation]);

  // Prevent accidental navigation while recording is active
  useEffect(() => {
    if (!shouldBlockNavigation) return;

    // Tab close / page refresh — browser shows native "Leave site?" dialog.
    // Also fire auto-pause + persist (with keepalive fetch) so the session
    // survives even if the user clicks "Reload". If they click "Cancel",
    // the recorder will be paused — they can resume.
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Fire-and-forget: pause recorder + persist session.
      // The persist fetch uses keepalive:true, so it completes even if
      // the page unloads before the response arrives.
      onBeforeLeaveRef.current?.();
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
  }, [shouldBlockNavigation]);

  return {
    navDialogOpen,
    closeNavDialog,
    confirmLeave,
    acquireWakeLock,
    releaseWakeLock,
    showRecordingNotification,
    closeRecordingNotification,
    audioInterrupted,
    setAudioContext,
  };
}
