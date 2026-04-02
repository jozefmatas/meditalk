"use client";

import { useState, useRef, useCallback } from "react";
import { logger } from "@/lib/logger";

type RecordingState = "idle" | "recording" | "paused";

/** Map recording MIME type to file extension. */
export function audioMimeToExt(mime: string): string {
  if (mime.includes("mp4")) return ".m4a";
  if (mime.includes("ogg")) return ".ogg";
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

export interface UseAudioRecorderReturn {
  state: RecordingState;
  duration: number;
  micError: boolean;
  recordingStream: MediaStream | null;

  /** Acquire mic and start recording. Returns the MediaStream for Scribe. */
  start: (deviceId?: string) => Promise<MediaStream | null>;

  /** Stop current recorder segment (keeps stream alive for resume). */
  pause: () => void;

  /** Create new recorder on existing stream. */
  resume: () => void;

  /**
   * Stop active recorder and return merged blob from all segments.
   * Does NOT release the mic or reset state — call `reset()` after.
   */
  stop: () => Promise<Blob | null>;

  /** Release mic tracks, clear timer, reset all state to idle. */
  reset: () => void;

  /** Emergency cleanup for unmount (stops recorder + releases tracks). */
  cleanupOnUnmount: () => void;
}

/**
 * Hook for managing the MediaRecorder lifecycle, chunk collection,
 * recording segments (pause/resume), and timer.
 */
export function useAudioRecorder(): UseAudioRecorderReturn {
  const [state, setState] = useState<RecordingState>("idle");
  const [duration, setDuration] = useState(0);
  const [micError, setMicError] = useState(false);
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(
    null,
  );

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const segmentsRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>("audio/webm");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedBeforePauseRef = useRef(0);
  const recordingStartRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);

  // ── Internal helpers ──

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

  /** Handler for ondataavailable — collects chunks. */
  const onDataAvailable = useCallback((e: BlobEvent) => {
    if (e.data.size > 0) {
      chunksRef.current.push(e.data);
    }
  }, []);

  /**
   * Create the onstop handler that saves the current segment in memory.
   * Used during normal pause — NOT during finalize (which overrides onstop).
   */
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
    async (deviceId?: string): Promise<MediaStream | null> => {
      setDuration(0);
      setMicError(false);
      elapsedBeforePauseRef.current = 0;
      segmentsRef.current = [];

      const mimeType = getSupportedMimeType();

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        });
        streamRef.current = stream;
        setRecordingStream(stream);

        mimeTypeRef.current = mimeType;
        const recorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = recorder;
        chunksRef.current = [];

        recorder.ondataavailable = onDataAvailable;
        recorder.onstop = createSegmentOnStop();

        // No timeslice — stop() delivers a single valid file.
        // Timeslice fragments can produce malformed containers on some Android
        // devices, causing WAV conversion and ElevenLabs batch transcription
        // to fail. Scribe streaming handles real-time transcript independently.
        recorder.start();

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
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === "recording") {
      // STOP (not pause) to finalize the current recording segment
      recorder.stop(); // triggers onstop → blob saved to segments array
    }
    pauseTimer();
    setState("paused");
  }, [pauseTimer]);

  const resume = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;

    const mimeType = mimeTypeRef.current;
    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = onDataAvailable;
    recorder.onstop = createSegmentOnStop();
    recorder.start();

    startTimer();
    setState("recording");
  }, [onDataAvailable, createSegmentOnStop, startTimer]);

  const stop = useCallback((): Promise<Blob | null> => {
    const recorder = mediaRecorderRef.current;

    // If recorder is already stopped, build from existing chunks/segments
    if (!recorder || recorder.state === "inactive") {
      const blob = buildBlob();
      chunksRef.current = [];
      const mergedBlob = mergeSegments(blob);
      segmentsRef.current = [];
      return Promise.resolve(mergedBlob);
    }

    // Override onstop to resolve with merged blob
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = buildBlob();
        chunksRef.current = [];
        const mergedBlob = mergeSegments(blob);
        segmentsRef.current = [];
        resolve(mergedBlob);
      };
      recorder.stop();
    });
  }, [buildBlob, mergeSegments]);

  const reset = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setRecordingStream(null);
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setState("idle");
    setDuration(0);
    elapsedBeforePauseRef.current = 0;
  }, []);

  const cleanupOnUnmount = useCallback(() => {
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
    start,
    pause,
    resume,
    stop,
    reset,
    cleanupOnUnmount,
  };
}
