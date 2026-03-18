"use client";

import { useEffect, useRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import {
  LiveWaveform as GeneratedLiveWaveform,
  type LiveWaveformProps as GeneratedLiveWaveformProps,
} from "@/components/generated/ui/live-waveform";

export type LiveWaveformProps = GeneratedLiveWaveformProps & {
  /** Provide an existing MediaStream for visualisation.
   *  Avoids a second getUserMedia() call (fixes mobile mic conflicts). */
  stream?: MediaStream | null;
};

/**
 * Shared LiveWaveform wrapper.
 * - When `stream` is provided the waveform visualises that stream directly
 *   without opening a second microphone (prevents mobile mic toggling).
 * - Otherwise delegates to the generated component which calls getUserMedia().
 */
export const LiveWaveform = ({ stream, ...props }: LiveWaveformProps) => {
  if (!stream) return <GeneratedLiveWaveform {...props} />;
  return <StreamWaveform stream={stream} {...props} />;
};

/* ------------------------------------------------------------------ */
/*  StreamWaveform — visualises an externally-provided MediaStream     */
/* ------------------------------------------------------------------ */

type StreamWaveformProps = Omit<
  LiveWaveformProps,
  "stream" | "deviceId" | "onStreamReady" | "onStreamEnd" | "onError"
> &
  HTMLAttributes<HTMLDivElement> & { stream: MediaStream };

function StreamWaveform({
  stream,
  active = false,
  processing = false,
  barWidth = 3,
  barGap = 1,
  barRadius = 1.5,
  barColor,
  fadeEdges = true,
  fadeWidth = 24,
  barHeight: baseBarHeight = 4,
  height = 64,
  sensitivity = 1,
  smoothingTimeConstant = 0.8,
  fftSize = 256,
  className,
  // Consume props that StreamWaveform doesn't need (avoid spreading onto div)
  historySize: _hs,
  updateRate: _ur,
  mode: _mode,
  ...divProps
}: StreamWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gradientCacheRef = useRef<CanvasGradient | null>(null);
  const lastWidthRef = useRef(0);

  const heightStyle = typeof height === "number" ? `${height}px` : height;

  // Canvas resize handling
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ro = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);
      gradientCacheRef.current = null;
      lastWidthRef.current = rect.width;
    });

    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Set up AudioContext + analyser from the provided stream
  useEffect(() => {
    if (!active || !stream) {
      if (
        audioContextRef.current &&
        audioContextRef.current.state !== "closed"
      ) {
        audioContextRef.current.close();
      }
      audioContextRef.current = null;
      analyserRef.current = null;
      return;
    }

    const AudioContextCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new AudioContextCtor();

    // Mobile: AudioContext may start in "suspended" state — resume explicitly
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const analyser = ctx.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = smoothingTimeConstant;

    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);

    audioContextRef.current = ctx;
    analyserRef.current = analyser;

    return () => {
      source.disconnect();
      if (ctx.state !== "closed") ctx.close();
      audioContextRef.current = null;
      analyserRef.current = null;
    };
  }, [active, stream, fftSize, smoothingTimeConstant]);

  // Animation loop — static-mode mirrored bars
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId: number;

    const animate = () => {
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);

      if (active && analyserRef.current) {
        // Try to resume if still suspended (mobile edge case)
        if (audioContextRef.current?.state === "suspended") {
          audioContextRef.current.resume().catch(() => {});
        }

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

        const startFreq = Math.floor(dataArray.length * 0.05);
        const endFreq = Math.floor(dataArray.length * 0.4);
        const relevantData = dataArray.slice(startFreq, endFreq);

        const step = barWidth + barGap;
        const barCount = Math.floor(rect.width / step);
        const halfCount = Math.floor(barCount / 2);
        const centerY = rect.height / 2;

        const computedBarColor =
          barColor || getComputedStyle(canvas).color || "#000";

        // Draw mirrored bars from center
        for (let i = 0; i < barCount; i++) {
          const mirrorIdx = i < halfCount ? halfCount - 1 - i : i - halfCount;
          const dataIndex = Math.floor(
            (mirrorIdx / halfCount) * relevantData.length,
          );
          const value = Math.min(
            1,
            (relevantData[dataIndex] / 255) * sensitivity,
          );
          const normalised = Math.max(0.05, value);

          const x = i * step;
          const barH = Math.max(baseBarHeight, normalised * rect.height * 0.8);
          const y = centerY - barH / 2;

          ctx.fillStyle = computedBarColor;
          ctx.globalAlpha = 0.4 + normalised * 0.6;

          if (barRadius > 0) {
            ctx.beginPath();
            ctx.roundRect(x, y, barWidth, barH, barRadius);
            ctx.fill();
          } else {
            ctx.fillRect(x, y, barWidth, barH);
          }
        }

        // Edge fading
        if (fadeEdges && fadeWidth > 0 && rect.width > 0) {
          if (
            !gradientCacheRef.current ||
            lastWidthRef.current !== rect.width
          ) {
            const gradient = ctx.createLinearGradient(0, 0, rect.width, 0);
            const fadePct = Math.min(0.3, fadeWidth / rect.width);
            gradient.addColorStop(0, "rgba(255,255,255,1)");
            gradient.addColorStop(fadePct, "rgba(255,255,255,0)");
            gradient.addColorStop(1 - fadePct, "rgba(255,255,255,0)");
            gradient.addColorStop(1, "rgba(255,255,255,1)");
            gradientCacheRef.current = gradient;
            lastWidthRef.current = rect.width;
          }
          ctx.globalCompositeOperation = "destination-out";
          ctx.fillStyle = gradientCacheRef.current;
          ctx.fillRect(0, 0, rect.width, rect.height);
          ctx.globalCompositeOperation = "source-over";
        }

        ctx.globalAlpha = 1;
      }

      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [
    active,
    sensitivity,
    barWidth,
    baseBarHeight,
    barGap,
    barRadius,
    barColor,
    fadeEdges,
    fadeWidth,
  ]);

  return (
    <div
      className={cn("relative h-full w-full", className)}
      ref={containerRef}
      style={{ height: heightStyle }}
      aria-label={active ? "Live audio waveform" : "Audio waveform idle"}
      role="img"
      {...divProps}
    >
      {!active && !processing && (
        <div className="border-muted-foreground/20 absolute top-1/2 right-0 left-0 -translate-y-1/2 border-t-2 border-dotted" />
      )}
      <canvas
        className="block h-full w-full"
        ref={canvasRef}
        aria-hidden="true"
      />
    </div>
  );
}
