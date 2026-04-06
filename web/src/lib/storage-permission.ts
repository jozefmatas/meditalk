import { registerPlugin } from "@capacitor/core";

export interface StoragePermissionPlugin {
  request(): Promise<{ granted: boolean }>;
  check(): Promise<{ granted: boolean }>;
}

/**
 * StoragePermission Capacitor plugin proxy.
 *
 * Requests READ_EXTERNAL_STORAGE (API < 33) or READ_MEDIA_IMAGES/VIDEO (API 33+)
 * so the WebView file picker can read selected files on Android.
 *
 * `registerPlugin` returns a synchronous Proxy — it must NOT be awaited
 * or returned from an async function, because JS would call `.then()`
 * on the Proxy and Capacitor would interpret that as a native method call.
 */
export const StoragePermission =
  registerPlugin<StoragePermissionPlugin>("StoragePermission");
