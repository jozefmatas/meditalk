import { registerPlugin } from "@capacitor/core";

export interface StoragePermissionPlugin {
  request(): Promise<{ granted: boolean }>;
  check(): Promise<{ granted: boolean }>;
}

/**
 * StoragePermission Capacitor plugin proxy.
 *
 * API < 33: Requests READ_EXTERNAL_STORAGE ("photos, media, and files" dialog).
 * API 33+: Returns granted immediately (file picker grants per-file URI access).
 *
 * `registerPlugin` returns a synchronous Proxy — it must NOT be awaited
 * or returned from an async function, because JS would call `.then()`
 * on the Proxy and Capacitor would interpret that as a native method call.
 */
export const StoragePermission =
  registerPlugin<StoragePermissionPlugin>("StoragePermission");
