"use client";

import { useRef, useCallback } from "react";

export interface UseScribeStreamingReturn {
  /** Start Scribe real-time streaming using the given mic stream. */
  startScribe: (stream: MediaStream) => Promise<void>;
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
 * Uses an AudioWorklet to downsample mic audio to 16 kHz on a dedicated thread,
 * then sends ~250 ms chunks over the Scribe WebSocket. This prevents the
 * queue_overflow error that occurred with ScriptProcessorNode (main-thread
 * callbacks would stall during React renders, then burst-fire).
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

  const startScribe = useCallback(
    async (stream: MediaStream) => {
      console.log("[scribe] Starting real-time transcription...");
      try {
        const tokenRes = await fetch("/api/scribe-token", { method: "POST" });
        if (!tokenRes.ok) {
          console.warn("[scribe] Token fetch failed, will fall back to batch");
          return;
        }
        const { token } = await tokenRes.json();

        const { Scribe, RealtimeEvents, AudioFormat, CommitStrategy } =
          await import("@elevenlabs/client");

        const audioCtx = new AudioContext();
        await audioCtx.resume(); // mobile browsers may start suspended
        audioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);

        console.log(
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
              console.log(
                `[scribe] Received transcript chunk (total: ${transcriptRef.current.length} chars)`,
              );
            }
          },
        );

        connection.on(RealtimeEvents.ERROR, (err: unknown) => {
          // Suppress expected "1006 - No reason provided" when pausing/stopping.
          // The error arrives as an object like { error: "WebSocket closed...", message_type: "error" },
          // so we must stringify properly (String({}) → "[object Object]" misses the check).
          const errStr =
            typeof err === "object" && err !== null
              ? JSON.stringify(err)
              : String(err);
          if (
            errStr.includes("1006") ||
            errStr.includes("No reason provided")
          ) {
            return; // Expected when closing connection (pause/stop/generate)
          }
          console.warn("[scribe] Streaming error:", err);
        });

        // ── AudioWorklet pipeline (off main thread) ──
        // Served as a static file to comply with CSP (blob: URLs are blocked).
        await audioCtx.audioWorklet.addModule("/scribe-processor.js");

        const workletNode = new AudioWorkletNode(audioCtx, "scribe-processor", {
          processorOptions: { nativeSampleRate: audioCtx.sampleRate },
        });

        // Worklet posts downsampled Float32 chunks → convert to Int16 base64 and send
        workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
          try {
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
        console.log("[scribe] Real-time connection established successfully");
      } catch (err) {
        console.warn("[scribe] Failed to start streaming:", err);
      }
    },
    [language],
  );

  const consumeTranscript = useCallback((): string | null => {
    const transcript = transcriptRef.current || null;
    transcriptRef.current = "";
    return transcript;
  }, []);

  return { startScribe, stopScribe, consumeTranscript };
}
