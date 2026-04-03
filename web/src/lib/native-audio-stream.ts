import { registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";

export interface NativeAudioStreamPlugin {
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<{ durationMs: number }>;
  getCurrentStatus(): Promise<{
    status: "NONE" | "RECORDING" | "PAUSED";
  }>;
  requestPermission(): Promise<{ permission: "granted" | "denied" }>;
  hasPermission(): Promise<{ permission: boolean }>;
  addListener(
    eventName: "audioChunk",
    handler: (data: { chunk: string }) => void,
  ): Promise<PluginListenerHandle>;
}

/**
 * NativeAudioStream Capacitor plugin proxy.
 *
 * `registerPlugin` returns a synchronous Proxy — it must NOT be awaited
 * or returned from an async function, because JS would call `.then()`
 * on the Proxy and Capacitor would interpret that as a native method call.
 */
export const NativeAudioStream =
  registerPlugin<NativeAudioStreamPlugin>("NativeAudioStream");
