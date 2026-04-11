"use client";

import { useState, useRef, useCallback } from "react";
import type { PluginListenerHandle } from "@capacitor/core";
import { logger } from "@/lib/logger";
import { isNative } from "@/lib/platform";
import type { NativeAudioStreamPlugin } from "@/lib/native-audio-stream";
import { WavBuilder } from "@/lib/wav-builder";

type RecordingState = "idle" | "recording" | "paused";

/** Map recording MIME type to file extension. */
export function audioMimeToExt(mime: string): string {
  if (mime.includes("mp4")) return ".m4a";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("wav")) return ".wav";
  return ".webm";
}

function getSupportedMimeType(): string {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  // Safari (iOS/macOS) always supports mp4 — fall back rather than
  // passing "" which can throw NotSupportedError on some browsers.
  return "audio/mp4";
}

export interface StartOptions {
  /** Web only: device ID for mic selection. Ignored on native. */
  deviceId?: string;
  /** Native only: callback for each audio chunk (base64 Int16 PCM 16 kHz). */
  onNativeChunk?: (base64: string) => void;
}

export interface UseAudioRecorderReturn {
  state: RecordingState;
  duration: number;
  micError: boolean;
  recordingStream: MediaStream | null;

  /** Native only: current audio level (0–1) computed from PCM chunks. */
  nativeLevel: number;

  /** Start recording. Returns MediaStream on web, null on native. */
  start: (options?: StartOptions) => Promise<MediaStream | null>;

  /**
   * Pause current recording. Uses native MediaRecorder.pause() on web
   * so the recording stays in a single container. Flushes data via
   * requestData() when available (with timeout fallback for Safari).
   */
  pause: () => Promise<void>;

  /** Resume paused recording. */
  resume: () => void;

  /**
   * Stop active recorder and return audio blob.
   * Web: single valid blob from all chunks (one container across pauses).
   * Native: WAV from accumulated chunks.
   * Does NOT release resources or reset state — call `reset()` after.
   */
  stop: () => Promise<Blob | null>;

  /** Release all resources, clear timer, reset state to idle. */
  reset: () => void;

  /** Emergency cleanup for unmount. */
  cleanupOnUnmount: () => void;

  /**
   * Non-destructive snapshot of the current recording as a blob.
   * Call after pause() to get the accumulated audio for upload to storage.
   * Web: all chunks so far (truncated but decodable). Native: WAV from PCM chunks.
   */
  getSnapshotBlob: () => Blob | null;
}

/**
 * Hook for managing audio recording.
 *
 * On **web**: Uses MediaRecorder with native pause()/resume() to maintain
 * a single container across pause/resume cycles. This ensures stop()
 * produces one valid file containing all audio.
 *
 * On **native** (iOS/Android): Uses NativeAudioStream Capacitor plugin for native
 * recording that works with the screen locked. Streams PCM chunks to JS via events.
 */
export function useAudioRecorder(): UseAudioRecorderReturn {
  const [state, setState] = useState<RecordingState>("idle");
  const [duration, setDuration] = useState(0);
  const [micError, setMicError] = useState(false);
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(
    null,
  );
  const [nativeLevel, setNativeLevel] = useState(0);

  // ── Shared refs ──
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedBeforePauseRef = useRef(0);
  const recordingStartRef = useRef(0);

  // ── Web-only refs ──
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>("audio/webm");
  const streamRef = useRef<MediaStream | null>(null);

  // ── Native-only refs ──
  const nativePluginRef = useRef<NativeAudioStreamPlugin | null>(null);
  const nativeListenerRef = useRef<PluginListenerHandle | null>(null);
  const wavBuilderRef = useRef<WavBuilder | null>(null);
  const nativeChunkCallbackRef = useRef<((base64: string) => void) | null>(
    null,
  );

  // ── Shared helpers ──

  const startTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    recordingStartRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed =
        elapsedBeforePauseRef.current +
        Math.floor((Date.now() - recordingStartRef.current) / 1000);
      setDuration(elapsed);
    }, 1000);
  }, []);

  const pauseTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    elapsedBeforePauseRef.current =
      elapsedBeforePauseRef.current +
      Math.floor((Date.now() - recordingStartRef.current) / 1000);
  }, []);

  // ── Web-only helpers ──

  const buildBlob = useCallback(() => {
    if (chunksRef.current.length === 0) return null;
    return new Blob(chunksRef.current, { type: mimeTypeRef.current });
  }, []);

  const onDataAvailable = useCallback((e: BlobEvent) => {
    if (e.data.size > 0) {
      chunksRef.current.push(e.data);
    }
  }, []);

  // ── Public API ──

  const start = useCallback(
    async (options?: StartOptions): Promise<MediaStream | null> => {
      setDuration(0);
      setMicError(false);
      elapsedBeforePauseRef.current = 0;

      // ── Native path ──
      if (isNative) {
        try {
          const { NativeAudioStream } =
            await import("@/lib/native-audio-stream");
          const plugin = NativeAudioStream;
          nativePluginRef.current = plugin;

          // Ensure microphone permission is granted before recording
          const permResult = await plugin.requestPermission();
          if (permResult.permission !== "granted") {
            logger.warn("[recording] Microphone permission denied");
            setMicError(true);
            return null;
          }

          // Fresh WAV builder for this recording session
          wavBuilderRef.current = new WavBuilder();
          nativeChunkCallbackRef.current = options?.onNativeChunk ?? null;

          // Listen for audio chunks from native plugin
          const handle = await plugin.addListener("audioChunk", (data) => {
            wavBuilderRef.current?.addChunk(data.chunk);
            nativeChunkCallbackRef.current?.(data.chunk);

            // Compute RMS level for waveform visualisation
            try {
              const bin = atob(data.chunk);
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              const samples = new Int16Array(bytes.buffer);
              let sum = 0;
              for (let i = 0; i < samples.length; i++) {
                const n = samples[i] / 32768;
                sum += n * n;
              }
              const rms = Math.sqrt(sum / samples.length);
              setNativeLevel(Math.min(1, rms * 3));
            } catch {
              // ignore decode errors
            }
          });
          nativeListenerRef.current = handle;

          await plugin.start();

          startTimer();
          setState("recording");
          logger.debug("[recording] Native recording started");
          return null; // No MediaStream on native
        } catch (err) {
          logger.warn("[recording] Native recording failed:", err);
          setMicError(true);
          return null;
        }
      }

      // ── Web path ──
      const mimeType = getSupportedMimeType();

      try {
        const constraints: MediaStreamConstraints = {
          audio: options?.deviceId
            ? { deviceId: { exact: options.deviceId } }
            : true,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        streamRef.current = stream;
        setRecordingStream(stream);

        // ── Diagnostic: track + visibility monitoring ──
        const track = stream.getAudioTracks()[0];
        if (track) {
          logger.info(
            `[rec-diag] Track: readyState=${track.readyState}, muted=${track.muted}, enabled=${track.enabled}`,
          );
          track.onended = () =>
            logger.warn("[rec-diag] TRACK ENDED (mic killed by OS?)");
          track.onmute = () => logger.warn("[rec-diag] TRACK MUTED");
          track.onunmute = () => logger.info("[rec-diag] Track unmuted");
        }

        const visHandler = () => {
          const vis = document.visibilityState;
          const tr = stream.getAudioTracks()[0];
          const rec = mediaRecorderRef.current;
          logger.info(
            `[rec-diag] Visibility=${vis} | track=${tr?.readyState ?? "gone"},muted=${tr?.muted} | recorder=${rec?.state ?? "gone"}`,
          );
        };
        document.addEventListener("visibilitychange", visHandler);
        stream.addEventListener("removetrack", () => {
          logger.warn("[rec-diag] STREAM removetrack fired");
          document.removeEventListener("visibilitychange", visHandler);
        });

        mimeTypeRef.current = mimeType;
        const recorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = recorder;
        chunksRef.current = [];

        recorder.ondataavailable = (e: BlobEvent) => {
          logger.info(
            `[rec-diag] Data chunk: ${e.data.size} bytes, recorder=${recorder.state}`,
          );
          onDataAvailable(e);
        };
        recorder.onerror = (e) =>
          logger.error("[rec-diag] MediaRecorder ERROR:", e);

        recorder.start();
        logger.info(
          `[rec-diag] Started: mime=${mimeType}, recorder=${recorder.state}`,
        );

        startTimer();
        setState("recording");
        return stream;
      } catch (err) {
        logger.warn("[recording] Mic access failed:", err);
        setMicError(true);
        return null;
      }
    },
    [onDataAvailable, startTimer],
  );

  const pause = useCallback((): Promise<void> => {
    logger.info(`[rec-diag] pause() called, isNative=${isNative}`);
    pauseTimer();

    if (isNative) {
      nativePluginRef.current
        ?.pause()
        .catch((e) => logger.warn("[recording] Native pause failed:", e));
      setState("paused");
      return Promise.resolve();
    }

    const recorder = mediaRecorderRef.current;
    logger.info(`[rec-diag] pause: recorder=${recorder?.state}`);

    if (!recorder || recorder.state !== "recording") {
      setState("paused");
      return Promise.resolve();
    }

    // Flush accumulated data via requestData(), then use native pause().
    // This keeps a single container so stop() produces one valid file
    // containing all audio across pause/resume cycles.
    //
    // IMPORTANT — mp4 (Safari / iOS): requestData() flushes an mp4 fragment
    // mid-recording. After resume + stop, the next fragment can't be
    // concatenated into a valid mp4 (headers conflict). Skip requestData()
    // on mp4 — stop() will produce one clean blob with all data.
    //
    // Other Safari quirks:
    // - requestData() may not exist on very old Safari (pre-14.1)
    // - Even when it exists, ondataavailable might not fire reliably
    // - We guard with try/catch + a 500ms timeout to prevent hangs
    const isMP4 = mimeTypeRef.current.includes("mp4");

    if (isMP4) {
      // mp4: skip requestData — just pause directly to keep one valid container
      try {
        recorder.pause();
      } catch (e) {
        logger.warn("[rec-diag] recorder.pause() threw:", e);
      }
      logger.info(
        `[rec-diag] MediaRecorder paused (mp4, no flush), chunks=${chunksRef.current.length}`,
      );
      setState("paused");
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        // Restore normal handler for future events (after resume)
        recorder.ondataavailable = (ev: BlobEvent) => onDataAvailable(ev);
        try {
          if (recorder.state === "recording") recorder.pause();
        } catch (e) {
          logger.warn("[rec-diag] recorder.pause() threw:", e);
        }
        logger.info(
          `[rec-diag] MediaRecorder paused, chunks=${chunksRef.current.length}`,
        );
        setState("paused");
        resolve();
      };

      // Timeout: if requestData doesn't fire ondataavailable within 500ms,
      // force-pause anyway. Data will be captured on stop() instead.
      const timeout = setTimeout(() => {
        logger.warn("[rec-diag] requestData timeout — forcing pause");
        settle();
      }, 500);

      recorder.ondataavailable = (e: BlobEvent) => {
        clearTimeout(timeout);
        onDataAvailable(e);
        settle();
      };

      try {
        if (typeof recorder.requestData === "function") {
          recorder.requestData();
        } else {
          // Safari < 14.1: requestData not available — force-pause directly
          logger.warn(
            "[rec-diag] requestData not available — pausing directly",
          );
          clearTimeout(timeout);
          settle();
        }
      } catch (e) {
        logger.warn("[rec-diag] requestData() threw:", e);
        clearTimeout(timeout);
        settle();
      }
    });
  }, [pauseTimer, onDataAvailable]);

  const resume = useCallback(() => {
    if (isNative) {
      nativePluginRef.current
        ?.resume()
        .catch((e) => logger.warn("[recording] Native resume failed:", e));
    } else {
      const recorder = mediaRecorderRef.current;
      if (!recorder) return;
      // Guard: if pause() couldn't actually pause the MediaRecorder (Safari
      // requestData hang), the recorder may still be "recording". Skip the
      // resume() call — it would throw on a non-paused recorder.
      if (recorder.state === "paused") {
        try {
          recorder.resume();
          logger.info("[rec-diag] MediaRecorder resumed");
        } catch (e) {
          logger.warn("[rec-diag] recorder.resume() threw:", e);
        }
      } else {
        logger.info(
          `[rec-diag] Skipping resume — recorder is "${recorder.state}", not "paused"`,
        );
      }
    }

    startTimer();
    setState("recording");
  }, [startTimer]);

  const stop = useCallback(async (): Promise<Blob | null> => {
    // ── Native path ──
    if (isNative) {
      try {
        // Remove listener first to stop receiving chunks
        await nativeListenerRef.current?.remove();
        nativeListenerRef.current = null;

        await nativePluginRef.current?.stop();
        nativePluginRef.current = null;

        const builder = wavBuilderRef.current;
        if (!builder?.hasData) return null;

        const blob = builder.toBlob();
        builder.reset();
        return blob;
      } catch (err) {
        logger.warn("[recording] Native stop failed:", err);
        return null;
      }
    }

    // ── Web path ──
    const recorder = mediaRecorderRef.current;
    const track = streamRef.current?.getAudioTracks()[0];
    logger.info(
      `[rec-diag] stop(): recorder=${recorder?.state}, track=${track?.readyState ?? "gone"}, chunks=${chunksRef.current.length}`,
    );

    if (!recorder || recorder.state === "inactive") {
      const blob = buildBlob();
      chunksRef.current = [];
      logger.info(`[rec-diag] stop() blob: ${blob?.size ?? 0} bytes`);
      return blob;
    }

    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = buildBlob();
        chunksRef.current = [];
        logger.info(`[rec-diag] stop() blob: ${blob?.size ?? 0} bytes`);
        resolve(blob);
      };
      recorder.stop();
    });
  }, [buildBlob]);

  const reset = useCallback(() => {
    if (isNative) {
      // Native cleanup
      nativeListenerRef.current?.remove();
      nativeListenerRef.current = null;
      nativePluginRef.current = null;
      wavBuilderRef.current?.reset();
      wavBuilderRef.current = null;
      nativeChunkCallbackRef.current = null;
    } else {
      // Web cleanup — release mic tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setRecordingStream(null);
      }
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setState("idle");
    setDuration(0);
    setNativeLevel(0);
    elapsedBeforePauseRef.current = 0;
  }, []);

  const cleanupOnUnmount = useCallback(() => {
    if (isNative) {
      nativeListenerRef.current?.remove();
      nativePluginRef.current?.stop().catch(() => {});
      nativePluginRef.current = null;
      nativeListenerRef.current = null;
    } else {
      if (mediaRecorderRef.current?.state !== "inactive") {
        try {
          mediaRecorderRef.current?.stop();
        } catch {
          // already stopped
        }
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const getSnapshotBlob = useCallback((): Blob | null => {
    if (isNative) {
      return wavBuilderRef.current?.toBlob() ?? null;
    }
    // Web: after pause(), chunksRef contains all data from this recording
    // session (single container). The blob is truncated (no end marker)
    // but decodable by most transcription services.
    if (chunksRef.current.length === 0) return null;
    return new Blob(chunksRef.current, { type: mimeTypeRef.current });
  }, []);

  return {
    state,
    duration,
    micError,
    recordingStream,
    nativeLevel,
    start,
    pause,
    resume,
    stop,
    reset,
    cleanupOnUnmount,
    getSnapshotBlob,
  };
}
