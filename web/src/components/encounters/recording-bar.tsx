"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/shared/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shared/select";
import { LiveWaveform } from "@/components/shared/live-waveform";
import { TemplateSelector } from "@/components/templates/template-selector";
import { HugeiconsIcon } from "@hugeicons/react";
import { Mic01Icon } from "@hugeicons/core-free-icons";

type RecordingState = "idle" | "recording" | "paused";

export interface RecordingBarRef {
  /** Stop recorder + Scribe stream, return blob and pre-transcribed text. */
  finalize: () => { blob: Blob | null; transcript: string | null };
}

interface RecordingBarProps {
  disabled?: boolean;
  onRecordingComplete: (blob: Blob) => void;
  onRecordingStateChange?: (state: RecordingState) => void;
  templateId: string;
  onTemplateChange: (id: string) => void;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
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
  return "audio/mp4";
}

export const RecordingBar = forwardRef<RecordingBarRef, RecordingBarProps>(
  function RecordingBar(
    {
      disabled,
      onRecordingComplete,
      onRecordingStateChange,
      templateId,
      onTemplateChange,
    },
    ref,
  ) {
    const t = useTranslations("encounters.detail");

    const [state, setState] = useState<RecordingState>("idle");
    const [duration, setDuration] = useState(0);
    const [recordingStream, setRecordingStream] = useState<MediaStream | null>(
      null,
    );

    // Device selection
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");

    // Recording refs
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const mimeTypeRef = useRef<string>("audio/webm");
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const elapsedBeforePauseRef = useRef(0);
    const recordingStartRef = useRef(0);

    // Scribe streaming refs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scribeRef = useRef<any>(null);
    const transcriptRef = useRef<string>("");

    // ── Keep-alive: Wake Lock + silent audio to survive screen lock in PWA ──
    const wakeLockRef = useRef<WakeLockSentinel | null>(null);
    const silentAudioRef = useRef<HTMLAudioElement | null>(null);

    /** Create a tiny silent WAV and loop it — keeps the audio session alive
     *  even when the screen is locked (iOS/Android suspend audio otherwise). */
    const startSilentAudio = useCallback(() => {
      if (silentAudioRef.current) return;
      const sampleRate = 8000;
      const numSamples = sampleRate; // 1 second
      const buffer = new ArrayBuffer(44 + numSamples * 2);
      const view = new DataView(buffer);
      const w = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++)
          view.setUint8(offset + i, str.charCodeAt(i));
      };
      w(0, "RIFF");
      view.setUint32(4, 36 + numSamples * 2, true);
      w(8, "WAVE");
      w(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      w(36, "data");
      view.setUint32(40, numSamples * 2, true);
      // samples stay zero → silence

      const blob = new Blob([buffer], { type: "audio/wav" });
      const audio = new Audio(URL.createObjectURL(blob));
      audio.loop = true;
      audio.volume = 0;
      audio.play().catch(() => {});
      silentAudioRef.current = audio;

      // Tell the OS we're actively recording
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: "MediTalk",
          artist: "Recording…",
        });
      }
    }, []);

    const stopSilentAudio = useCallback(() => {
      if (silentAudioRef.current) {
        silentAudioRef.current.pause();
        const src = silentAudioRef.current.src;
        silentAudioRef.current.src = "";
        URL.revokeObjectURL(src);
        silentAudioRef.current = null;
      }
    }, []);

    const acquireWakeLock = useCallback(async () => {
      if (!("wakeLock" in navigator)) return;
      try {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        wakeLockRef.current.addEventListener("release", () => {
          wakeLockRef.current = null;
        });
      } catch {
        // Wake lock request failed (e.g. low battery, page hidden)
      }
    }, []);

    const releaseWakeLock = useCallback(() => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    }, []);

    /** Acquire both keep-alive mechanisms */
    const acquireKeepAlive = useCallback(async () => {
      startSilentAudio();
      await acquireWakeLock();
    }, [startSilentAudio, acquireWakeLock]);

    /** Release both keep-alive mechanisms */
    const releaseKeepAlive = useCallback(() => {
      stopSilentAudio();
      releaseWakeLock();
    }, [stopSilentAudio, releaseWakeLock]);

    // Re-acquire wake lock when page becomes visible again (OS releases it on hide)
    useEffect(() => {
      const handleVisibilityChange = () => {
        if (
          document.visibilityState === "visible" &&
          state !== "idle" &&
          !wakeLockRef.current
        ) {
          acquireWakeLock();
        }
      };
      document.addEventListener("visibilitychange", handleVisibilityChange);
      return () =>
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
    }, [state, acquireWakeLock]);

    // Enumerate audio devices on mount
    useEffect(() => {
      async function loadDevices() {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          stream.getTracks().forEach((track) => track.stop());

          const allDevices = await navigator.mediaDevices.enumerateDevices();
          const audioInputs = allDevices.filter(
            (d) => d.kind === "audioinput" && d.deviceId !== "",
          );
          setDevices(audioInputs);
          if (audioInputs.length > 0 && !selectedDeviceId) {
            setSelectedDeviceId(audioInputs[0].deviceId);
          }
        } catch {
          // Can't enumerate — will use default
        }
      }
      loadDevices();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /** Build blob from accumulated chunks */
    const buildBlob = useCallback(() => {
      if (chunksRef.current.length === 0) return null;
      return new Blob(chunksRef.current, { type: mimeTypeRef.current });
    }, []);

    /** Start Scribe real-time streaming (fire-and-forget, non-blocking) */
    const startScribe = useCallback(async (deviceId?: string) => {
      try {
        // Fetch single-use token from server
        const tokenRes = await fetch("/api/scribe-token", { method: "POST" });
        if (!tokenRes.ok) {
          console.warn("[scribe] Token fetch failed, will fall back to batch");
          return;
        }
        const { token } = await tokenRes.json();

        // Dynamically import client SDK to keep bundle lean
        const { Scribe, RealtimeEvents } = await import("@elevenlabs/client");

        const connection = Scribe.connect({
          token,
          modelId: "scribe_v2",
          microphone: {
            deviceId: deviceId || undefined,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        });

        connection.on(
          RealtimeEvents.COMMITTED_TRANSCRIPT,
          (msg: { text: string }) => {
            if (msg.text) {
              transcriptRef.current = transcriptRef.current
                ? transcriptRef.current + " " + msg.text
                : msg.text;
            }
          },
        );

        connection.on(RealtimeEvents.ERROR, (err: unknown) => {
          console.warn("[scribe] Streaming error:", err);
        });

        scribeRef.current = connection;
      } catch (err) {
        console.warn("[scribe] Failed to start streaming:", err);
      }
    }, []);

    /** Stop Scribe connection */
    const stopScribe = useCallback(() => {
      if (scribeRef.current) {
        try {
          scribeRef.current.close();
        } catch {
          // ignore
        }
        scribeRef.current = null;
      }
    }, []);

    /** Expose finalize() so the page can stop & grab the blob + transcript */
    useImperativeHandle(
      ref,
      () => ({
        finalize: () => {
          const recorder = mediaRecorderRef.current;
          if (recorder && recorder.state !== "inactive") {
            recorder.stop();
          }
          // Stop the recording stream we own
          if (recordingStreamRef.current) {
            recordingStreamRef.current.getTracks().forEach((t) => t.stop());
            recordingStreamRef.current = null;
            setRecordingStream(null);
          }
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }

          // Stop Scribe and grab transcript
          stopScribe();
          const transcript = transcriptRef.current || null;
          transcriptRef.current = "";

          // Allow screen to lock again
          releaseKeepAlive();

          setState("idle");
          setDuration(0);
          elapsedBeforePauseRef.current = 0;
          const blob = buildBlob();
          chunksRef.current = [];
          return { blob, transcript };
        },
      }),
      [buildBlob, stopScribe, releaseKeepAlive],
    );

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

    // We manage the recording stream ourselves, independent of LiveWaveform.
    // LiveWaveform is purely visual — it creates its own stream for visualization.
    const recordingStreamRef = useRef<MediaStream | null>(null);

    // --- Actions ---

    const handleStart = useCallback(async () => {
      setDuration(0);
      elapsedBeforePauseRef.current = 0;
      transcriptRef.current = "";

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: selectedDeviceId
            ? { deviceId: { exact: selectedDeviceId } }
            : true,
        });
        recordingStreamRef.current = stream;
        setRecordingStream(stream);

        const mimeType = getSupportedMimeType();
        mimeTypeRef.current = mimeType;
        const recorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = recorder;
        chunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunksRef.current.push(e.data);
          }
        };

        recorder.onstop = () => {
          const blob = buildBlob();
          if (blob) onRecordingComplete(blob);
        };

        recorder.start(1000);

        // Start Scribe streaming in parallel (non-blocking)
        startScribe(selectedDeviceId || undefined);

        // Keep screen awake + audio session alive during recording
        acquireKeepAlive();

        startTimer();
        setState("recording");
        onRecordingStateChange?.("recording");
      } catch {
        // Mic access denied — stay idle
      }
    }, [
      selectedDeviceId,
      buildBlob,
      onRecordingComplete,
      startTimer,
      onRecordingStateChange,
      startScribe,
      acquireKeepAlive,
    ]);

    const handlePause = useCallback(() => {
      const recorder = mediaRecorderRef.current;
      if (recorder?.state === "recording") {
        recorder.pause();
      }
      // Close Scribe on pause to avoid transcribing silence
      stopScribe();
      pauseTimer();
      setState("paused");
      onRecordingStateChange?.("paused");
    }, [pauseTimer, onRecordingStateChange, stopScribe]);

    const handleResume = useCallback(() => {
      const recorder = mediaRecorderRef.current;
      if (recorder?.state === "paused") {
        recorder.resume();
      }
      // Reconnect Scribe with context from previous transcript
      startScribe(selectedDeviceId || undefined);
      startTimer();
      setState("recording");
      onRecordingStateChange?.("recording");
    }, [startTimer, onRecordingStateChange, startScribe, selectedDeviceId]);

    // Device selector element — shared between idle & paused states
    const deviceSelector =
      devices.length > 1 ? (
        <Select
          value={selectedDeviceId}
          onValueChange={setSelectedDeviceId}
          disabled={state === "recording" || !!disabled}
        >
          <SelectTrigger
            variant="ghost"
            className="w-full min-w-0 px-2 desktop:w-auto"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <HugeiconsIcon
                icon={Mic01Icon}
                size={16}
                className="shrink-0 text-foreground"
              />
              <SelectValue className="truncate text-left" />
            </span>
          </SelectTrigger>
          <SelectContent>
            {devices.map((device) => (
              <SelectItem key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${device.deviceId.slice(0, 5)}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : devices.length === 1 ? (
        <span className="flex w-full items-center truncate text-sm text-muted-foreground desktop:w-auto">
          <HugeiconsIcon
            icon={Mic01Icon}
            size={16}
            className="mr-1.5 inline shrink-0 text-foreground"
          />
          {devices[0].label || t("defaultMicrophone")}
        </span>
      ) : null;

    /* ── Idle: template selector (left) | mic + start button (right) ── */
    if (state === "idle") {
      return (
        <div className="flex flex-col gap-3 desktop:flex-row desktop:items-center desktop:justify-between desktop:gap-4">
          <TemplateSelector
            value={templateId}
            onChange={onTemplateChange}
            disabled={!!disabled}
            size="lg"
            label={t("templateLabel")}
            className="w-full desktop:w-auto desktop:max-w-[320px]"
          />
          {/* Mobile: button then mic (reversed from desktop) */}
          <Button
            variant="secondary"
            size="lg"
            onClick={handleStart}
            disabled={!!disabled}
            className="w-full shrink-0 desktop:hidden"
          >
            {t("startRecording")}
          </Button>
          <div className="w-full desktop:hidden">{deviceSelector}</div>
          {/* Desktop: mic then button */}
          <div className="hidden min-w-0 items-center gap-3 desktop:flex">
            {deviceSelector}
            <Button
              variant="secondary"
              size="lg"
              onClick={handleStart}
              disabled={!!disabled}
              className="shrink-0"
            >
              {t("startRecording")}
            </Button>
          </div>
        </div>
      );
    }

    /* ── Recording: waveform (left) | status + pause button (right) ── */
    if (state === "recording") {
      return (
        <div className="flex flex-col gap-3 desktop:flex-row desktop:items-center desktop:justify-between desktop:gap-4">
          <div className="h-9 min-w-0 max-w-full flex-1 text-foreground desktop:max-w-[360px]">
            <LiveWaveform
              active
              stream={recordingStream}
              height={36}
              barWidth={2}
              barGap={1}
              barRadius={1}
              barHeight={3}
              sensitivity={1.5}
              mode="static"
              fadeEdges
              fadeWidth={16}
            />
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3 desktop:justify-start">
            <span className="flex items-center gap-2 text-sm font-medium text-destructive">
              <span className="inline-block size-1.5 animate-pulse rounded-full bg-destructive" />
              {t("recordingStatus")} {formatDuration(duration)}
            </span>
            <Button
              size="lg"
              onClick={handlePause}
              className="shrink-0 border-none bg-destructive/10 text-destructive shadow-none hover:bg-destructive/15"
            >
              {t("pause")}
            </Button>
          </div>
        </div>
      );
    }

    /* ── Paused: template selector (left) | mic + divider + status + resume button (right) ── */
    return (
      <div className="flex flex-col gap-3 desktop:flex-row desktop:items-center desktop:justify-between desktop:gap-4">
        <TemplateSelector
          value={templateId}
          onChange={onTemplateChange}
          disabled={!!disabled}
          size="lg"
          label={t("templateLabel")}
          className="w-full desktop:w-auto desktop:max-w-[280px]"
        />
        <div className="flex min-w-0 flex-col gap-3 desktop:flex-row desktop:items-center desktop:gap-5">
          <div className="hidden min-w-0 items-center gap-3 desktop:flex">
            {deviceSelector}
            <div className="h-6 w-px shrink-0 bg-border" />
          </div>
          <div className="flex items-center justify-between gap-3 desktop:justify-start">
            <span className="flex shrink-0 items-center gap-2 text-sm font-medium text-status-to_review">
              <span className="inline-block size-1.5 rounded-full bg-status-to_review" />
              {t("pausedStatus")} {formatDuration(duration)}
            </span>
            <Button
              variant="secondary"
              size="lg"
              onClick={handleResume}
              className="shrink-0"
            >
              {t("resume")}
            </Button>
          </div>
        </div>
      </div>
    );
  },
);
