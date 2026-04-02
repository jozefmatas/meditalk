/**
 * Platform detection utilities for Capacitor native vs. web contexts.
 *
 * Import from here rather than `@capacitor/core` directly — centralises
 * the logic and keeps downstream code free of Capacitor imports.
 */

import { Capacitor } from "@capacitor/core";

/** True when running inside a native iOS or Android container. */
export const isNative = Capacitor.isNativePlatform();

/** True when running on iOS (native only). */
export const isIOS = Capacitor.getPlatform() === "ios";

/** True when running on Android (native only). */
export const isAndroid = Capacitor.getPlatform() === "android";

/** True when running in a regular browser (not wrapped by Capacitor). */
export const isWeb = Capacitor.getPlatform() === "web";
