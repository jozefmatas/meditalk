"use client";

import { useRef, useCallback } from "react";
import { logger } from "@/lib/logger";

export interface UseScribeStreamingReturn {
  /** Web: Start Scribe real-time streaming using the given mic stream. Returns the AudioContext. */
  startScribe: (stream: MediaStream) => Promise<AudioContext | null>;
  /** Native: Start Scribe connection without AudioWorklet. Chunks are sent via sendChunk(). */
  startScribeNative: () => Promise<void>;
  /** Native: Send a base64-encoded Int16 PCM chunk directly to the Scribe connection. */
  sendChunk: (base64: string) => void;
  /** Stop Scribe connection and audio pipeline. */
  stopScribe: () => void;
  /** Read and reset the accumulated transcript. Returns null if empty. */
  consumeTranscript: () => string | null;
}

// ── Constants ──

/** Scribe works best at 16 kHz — always downsample to this rate. */
const SCRIBE_SAMPLE_RATE = 16000;

// ── Helpers ──

/** Convert Float32 PCM → Int16 PCM → base64 string for Scribe. */
function float32ToBase64Int16(pcm: Float32Array): string {
  const int16 = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

// ── Hook ──

/**
 * Hook for managing ElevenLabs Scribe real-time transcription.
 *
 * **Web mode** (`startScribe`): Uses AudioWorklet to downsample mic audio to
 * 16 kHz on a dedicated thread, then sends chunks over the Scribe WebSocket.
 *
 * **Native mode** (`startScribeNative` + `sendChunk`): Opens only the WebSocket
 * connection. Audio chunks arrive from the NativeAudioStream Capacitor plugin
 * (already 16 kHz Int16 PCM) and are forwarded directly via `sendChunk()`.
 */
export function useScribeStreaming(
  language?: string,
): UseScribeStreamingReturn {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scribeRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const transcriptRef = useRef<string>("");

  const stopScribe = useCallback(() => {
    // Close AudioContext first — this stops the worklet pipeline so no more
    // audio data is sent to the Scribe connection before we close it.
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch {
        // ignore
      }
      audioCtxRef.current = null;
    }
    if (scribeRef.current) {
      try {
        scribeRef.current.close();
      } catch {
        // ignore
      }
      scribeRef.current = null;
    }
  }, []);

  // ── Web mode: full AudioWorklet pipeline ──

  const startScribe = useCallback(
    async (stream: MediaStream): Promise<AudioContext | null> => {
      logger.debug("[scribe] Starting real-time transcription...");
      try {
        const tokenRes = await fetch("/api/scribe-token", { method: "POST" });
        if (!tokenRes.ok) {
          logger.warn("[scribe] Token fetch failed, will fall back to batch");
          return null;
        }
        const { token } = await tokenRes.json();

        const { Scribe, RealtimeEvents, AudioFormat, CommitStrategy } =
          await import("@elevenlabs/client");

        const audioCtx = new AudioContext();
        await audioCtx.resume(); // mobile browsers may start suspended
        audioCtxRef.current = audioCtx;

        // ── Diagnostic: AudioContext state monitoring ──
        logger.info(
          `[scribe-diag] AudioContext: state=${audioCtx.state}, sampleRate=${audioCtx.sampleRate}`,
        );
        audioCtx.onstatechange = () =>
          logger.info(`[scribe-diag] AudioContext state → ${audioCtx.state}`);

        const source = audioCtx.createMediaStreamSource(stream);

        logger.debug(
          `[scribe] Native sample rate: ${audioCtx.sampleRate}Hz → downsampling to ${SCRIBE_SAMPLE_RATE}Hz`,
        );

        // Always connect at 16 kHz — the worklet handles downsampling
        const connection = Scribe.connect({
          token,
          modelId: "scribe_v2_realtime",
          audioFormat: AudioFormat.PCM_16000,
          sampleRate: SCRIBE_SAMPLE_RATE,
          commitStrategy: CommitStrategy.VAD,
          ...(language && { languageCode: language }),
        });

        connection.on(
          RealtimeEvents.COMMITTED_TRANSCRIPT,
          (msg: { text: string }) => {
            if (msg.text) {
              transcriptRef.current = transcriptRef.current
                ? transcriptRef.current + " " + msg.text
                : msg.text;
              logger.debug(
                `[scribe] Received transcript chunk (total: ${transcriptRef.current.length} chars)`,
              );
            }
          },
        );

        connection.on(RealtimeEvents.ERROR, (err: unknown) => {
          // Suppress expected WebSocket close events when pausing/stopping.
          // The SDK fires errors in multiple shapes:
          //   1. DOM Event (WebSocket onerror) — always a close artifact
          //   2. Error instance — message has "1006" / "No reason provided"
          //   3. Plain object { error: "...", message_type: "error" }
          // JSON.stringify loses Error.message and DOM Event fields, so
          // we check each shape individually.

          // DOM Event from WebSocket onerror — always expected on close
          if (err instanceof Event) return;

          // Error instance — check message
          if (err instanceof Error) {
            const msg = err.message;
            if (msg.includes("1006") || msg.includes("No reason provided")) {
              return;
            }
          }

          // Plain object — stringify and check
          if (typeof err === "object" && err !== null) {
            try {
              const s = JSON.stringify(err);
              if (s.includes("1006") || s.includes("No reason provided")) {
                return;
              }
            } catch {
              // circular ref — fall through to warn
            }
          }

          // String error
          if (typeof err === "string") {
            if (err.includes("1006") || err.includes("No reason provided")) {
              return;
            }
          }

          logger.warn("[scribe] Streaming error:", err);
        });

        // ── AudioWorklet pipeline (off main thread) ──
        // Served as a static file to comply with CSP (blob: URLs are blocked).
        await audioCtx.audioWorklet.addModule("/scribe-processor.js");

        const workletNode = new AudioWorkletNode(audioCtx, "scribe-processor", {
          processorOptions: { nativeSampleRate: audioCtx.sampleRate },
        });

        // Worklet posts downsampled Float32 chunks → convert to Int16 base64 and send
        let chunkCount = 0;
        workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
          try {
            chunkCount++;
            if (chunkCount <= 3 || chunkCount % 20 === 0) {
              const maxVal = e.data.reduce(
                (m, v) => Math.max(m, Math.abs(v)),
                0,
              );
              logger.debug(
                `[scribe] Audio chunk #${chunkCount}: ${e.data.length} samples, peak=${maxVal.toFixed(4)}`,
              );
            }
            connection.send({ audioBase64: float32ToBase64Int16(e.data) });
          } catch {
            // Connection closed
          }
        };

        // Connect: source → worklet → silent gain → destination
        // The worklet must be connected to the destination to stay actively processing.
        // The silent gain prevents any audible output.
        const silent = audioCtx.createGain();
        silent.gain.value = 0;
        source.connect(workletNode);
        workletNode.connect(silent);
        silent.connect(audioCtx.destination);

        scribeRef.current = connection;
        logger.debug("[scribe] Real-time connection established successfully");
        return audioCtx;
      } catch (err) {
        logger.warn("[scribe] Failed to start streaming:", err);
        return null;
      }
    },
    [language],
  );

  // ── Native mode: WebSocket only, no AudioWorklet ──

  const startScribeNative = useCallback(async (): Promise<void> => {
    logger.debug("[scribe] Starting native real-time transcription...");
    try {
      const tokenRes = await fetch("/api/scribe-token", { method: "POST" });
      if (!tokenRes.ok) {
        logger.warn("[scribe] Token fetch failed, will fall back to batch");
        return;
      }
      const { token } = await tokenRes.json();

      const { Scribe, RealtimeEvents, AudioFormat, CommitStrategy } =
        await import("@elevenlabs/client");

      const connection = Scribe.connect({
        token,
        modelId: "scribe_v2_realtime",
        audioFormat: AudioFormat.PCM_16000,
        sampleRate: SCRIBE_SAMPLE_RATE,
        commitStrategy: CommitStrategy.VAD,
        ...(language && { languageCode: language }),
      });

      connection.on(
        RealtimeEvents.COMMITTED_TRANSCRIPT,
        (msg: { text: string }) => {
          if (msg.text) {
            transcriptRef.current = transcriptRef.current
              ? transcriptRef.current + " " + msg.text
              : msg.text;
            logger.debug(
              `[scribe] Received transcript chunk (total: ${transcriptRef.current.length} chars)`,
            );
          }
        },
      );

      connection.on(RealtimeEvents.ERROR, (err: unknown) => {
        if (err instanceof Event) return;
        if (err instanceof Error) {
          const msg = err.message;
          if (msg.includes("1006") || msg.includes("No reason provided"))
            return;
        }
        if (typeof err === "object" && err !== null) {
          try {
            const s = JSON.stringify(err);
            if (s.includes("1006") || s.includes("No reason provided")) return;
          } catch {
            // fall through
          }
        }
        if (typeof err === "string") {
          if (err.includes("1006") || err.includes("No reason provided"))
            return;
        }
        logger.warn("[scribe] Streaming error:", err);
      });

      scribeRef.current = connection;
      logger.debug(
        "[scribe] Native real-time connection established successfully",
      );
    } catch (err) {
      logger.warn("[scribe] Failed to start native streaming:", err);
    }
  }, [language]);

  /** Send a pre-encoded audio chunk directly to the Scribe WebSocket. */
  const sendChunk = useCallback((base64: string): void => {
    try {
      scribeRef.current?.send({ audioBase64: base64 });
    } catch {
      // Connection closed
    }
  }, []);

  const consumeTranscript = useCallback((): string | null => {
    const transcript = transcriptRef.current || null;
    transcriptRef.current = "";
    return transcript;
  }, []);

  return {
    startScribe,
    startScribeNative,
    sendChunk,
    stopScribe,
    consumeTranscript,
  };
}
