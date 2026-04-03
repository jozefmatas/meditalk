import { isNative, isAndroid } from "@/lib/platform";
import { logger } from "@/lib/logger";

/**
 * Start an Android foreground service with microphone type.
 *
 * Keeps the WebView process alive when the screen is locked, ensuring
 * `getUserMedia` and `MediaRecorder` continue capturing audio.
 * Shows a persistent notification in the system tray.
 *
 * No-op on iOS (UIBackgroundModes:audio handles it) and web.
 */
export async function nativeStartRecordingService(
  title: string,
  body: string,
): Promise<void> {
  if (!isNative || !isAndroid) return;
  try {
    const { ForegroundService, ServiceType } =
      await import("@capawesome-team/capacitor-android-foreground-service");
    await ForegroundService.startForegroundService({
      id: 9001,
      title,
      body,
      smallIcon: "ic_stat_recording",
      serviceType: ServiceType.Microphone,
    });
  } catch (err) {
    logger.warn("[native-guards] ForegroundService start failed:", err);
  }
}

/**
 * Stop the Android foreground service.
 *
 * No-op on iOS and web.
 */
export async function nativeStopRecordingService(): Promise<void> {
  if (!isNative || !isAndroid) return;
  try {
    const { ForegroundService } =
      await import("@capawesome-team/capacitor-android-foreground-service");
    await ForegroundService.stopForegroundService();
  } catch (err) {
    logger.warn("[native-guards] ForegroundService stop failed:", err);
  }
}
