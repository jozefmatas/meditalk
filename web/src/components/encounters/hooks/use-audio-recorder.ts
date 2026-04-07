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
  // Prefer WebM — handles chunked recording (timeslice) correctly.
  // MP4 (Safari-only) fragments don't concatenate into valid files,
  // so we use it only as a last resort and skip timeslice for it.
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
  return "";
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

  /** Start recording. Returns MediaStream on web (for Scribe), null on native. */
  start: (options?: StartOptions) => Promise<MediaStream | null>;

  /** Pause current recording (keeps resources alive for resume). */
  pause: () => void;

  /** Resume paused recording. */
  resume: () => void;

  /**
   * Stop active recorder and return audio blob.
   * Web: merged MediaRecorder segments. Native: WAV from accumulated chunks.
   * Does NOT release resources or reset state — call `reset()` after.
   */
  stop: () => Promise<Blob | null>;

  /** Release all resources, clear timer, reset state to idle. */
  reset: () => void;

  /** Emergency cleanup for unmount. */
  cleanupOnUnmount: () => void;
}

/**
 * Hook for managing audio recording.
 *
 * On **web**: Uses MediaRecorder for blob capture + returns MediaStream for Scribe.
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
  const segmentsRef = useRef<Blob[]>([]);
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

  const mergeSegments = useCallback((finalSegment: Blob | null) => {
    const allSegments = [...segmentsRef.current];
    if (finalSegment) allSegments.push(finalSegment);
    if (allSegments.length === 0) return null;
    if (allSegments.length === 1) return allSegments[0];
    return new Blob(allSegments, { type: mimeTypeRef.current });
  }, []);

  const onDataAvailable = useCallback((e: BlobEvent) => {
    if (e.data.size > 0) {
      chunksRef.current.push(e.data);
    }
  }, []);

  const createSegmentOnStop = useCallback(() => {
    return () => {
      const blob = buildBlob();
      chunksRef.current = [];
      if (blob) {
        segmentsRef.current.push(blob);
      }
    };
  }, [buildBlob]);

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
      segmentsRef.current = [];
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
        recorder.onstop = () => {
          logger.info("[rec-diag] MediaRecorder onstop fired");
          createSegmentOnStop()();
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
    [onDataAvailable, createSegmentOnStop, startTimer],
  );

  const pause = useCallback(() => {
    logger.info(`[rec-diag] pause() called, isNative=${isNative}`);
    if (isNative) {
      nativePluginRef.current
        ?.pause()
        .catch((e) => logger.warn("[recording] Native pause failed:", e));
    } else {
      const recorder = mediaRecorderRef.current;
      logger.info(`[rec-diag] pause: recorder=${recorder?.state}`);
      if (recorder?.state === "recording") {
        recorder.stop(); // triggers onstop → blob saved to segments array
      }
    }
    pauseTimer();
    setState("paused");
  }, [pauseTimer]);

  const resume = useCallback(() => {
    if (isNative) {
      nativePluginRef.current
        ?.resume()
        .catch((e) => logger.warn("[recording] Native resume failed:", e));
    } else {
      const stream = streamRef.current;
      if (!stream) return;

      const mimeType = mimeTypeRef.current;
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = onDataAvailable;
      recorder.onstop = createSegmentOnStop();
      recorder.start();
    }

    startTimer();
    setState("recording");
  }, [onDataAvailable, createSegmentOnStop, startTimer]);

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
      `[rec-diag] stop(): recorder=${recorder?.state}, track=${track?.readyState ?? "gone"}, chunks=${chunksRef.current.length}, segments=${segmentsRef.current.length}`,
    );

    if (!recorder || recorder.state === "inactive") {
      const blob = buildBlob();
      chunksRef.current = [];
      const mergedBlob = mergeSegments(blob);
      segmentsRef.current = [];
      logger.info(`[rec-diag] stop() merged: ${mergedBlob?.size ?? 0} bytes`);
      return mergedBlob;
    }

    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = buildBlob();
        chunksRef.current = [];
        const mergedBlob = mergeSegments(blob);
        segmentsRef.current = [];
        logger.info(`[rec-diag] stop() merged: ${mergedBlob?.size ?? 0} bytes`);
        resolve(mergedBlob);
      };
      recorder.stop();
    });
  }, [buildBlob, mergeSegments]);

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
  };
}
