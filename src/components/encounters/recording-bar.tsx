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
import {
  LiveWaveform,
  type LiveWaveformProps,
} from "@/components/shared/live-waveform";
import { HugeiconsIcon } from "@hugeicons/react";
import { Mic01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

type RecordingState = "idle" | "recording" | "paused";

export interface RecordingBarRef {
  /** Stop recorder (if active) and return the accumulated blob, or null. */
  finalize: () => Blob | null;
}

interface RecordingBarProps {
  hasRecording: boolean;
  hasTranscript: boolean;
  disabled?: boolean;
  onRecordingComplete: (blob: Blob) => void;
  onRecordingStateChange?: (state: RecordingState) => void;
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
    { hasRecording, hasTranscript, disabled, onRecordingComplete, onRecordingStateChange },
    ref
  ) {
    const t = useTranslations("encounters.detail");

    const [state, setState] = useState<RecordingState>("idle");
    const [duration, setDuration] = useState(0);

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
            (d) => d.kind === "audioinput" && d.deviceId !== ""
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

    /** Expose finalize() so the page can stop & grab the blob (e.g. on Generate) */
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
          }
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          setState("idle");
          setDuration(0);
          elapsedBeforePauseRef.current = 0;
          const blob = buildBlob();
          chunksRef.current = [];
          return blob;
        },
      }),
      [buildBlob]
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

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: selectedDeviceId
            ? { deviceId: { exact: selectedDeviceId } }
            : true,
        });
        recordingStreamRef.current = stream;

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
        startTimer();
        setState("recording");
        onRecordingStateChange?.("recording");
      } catch {
        // Mic access denied — stay idle
      }
    }, [selectedDeviceId, buildBlob, onRecordingComplete, startTimer, onRecordingStateChange]);

    const handlePause = useCallback(() => {
      const recorder = mediaRecorderRef.current;
      if (recorder?.state === "recording") {
        recorder.pause();
      }
      pauseTimer();
      setState("paused");
      onRecordingStateChange?.("paused");
    }, [pauseTimer, onRecordingStateChange]);

    const handleResume = useCallback(() => {
      const recorder = mediaRecorderRef.current;
      if (recorder?.state === "paused") {
        recorder.resume();
      }
      startTimer();
      setState("recording");
      onRecordingStateChange?.("recording");
    }, [startTimer, onRecordingStateChange]);

    // LiveWaveform is visual-only — active when recording, idle when paused.
    // Our recording stream is managed independently so pause doesn't kill it.
    const waveformActive = state === "recording";

    return (
      <div className="flex items-center justify-between gap-4">
        {/* Left: action button + device selector */}
        <div className="flex items-center gap-3">
          {state === "idle" && (
            <Button
              variant="secondary"
              size="lg"
              onClick={handleStart}
              disabled={!!disabled}
              className="rounded-xl"
            >
              {t("startRecording")}
            </Button>
          )}

          {state === "recording" && (
            <Button
              size="lg"
              onClick={handlePause}
              className="rounded-xl border-none bg-destructive/10 text-destructive shadow-none hover:bg-destructive/15"
            >
              {t("pause")}
            </Button>
          )}

          {state === "paused" && (
            <Button
              variant="secondary"
              size="lg"
              onClick={handleResume}
              className="rounded-xl"
            >
              {t("resume")}
            </Button>
          )}

          {/* Device selector */}
          {devices.length > 1 && (
            <Select
              value={selectedDeviceId}
              onValueChange={setSelectedDeviceId}
              disabled={state !== "idle" || !!disabled}
            >
              <SelectTrigger variant="ghost" className="max-w-[220px] px-2">
                <HugeiconsIcon icon={Mic01Icon} size={16} className="shrink-0 text-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {devices.map((device) => (
                  <SelectItem key={device.deviceId} value={device.deviceId}>
                    {device.label ||
                      `Microphone ${device.deviceId.slice(0, 5)}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {devices.length === 1 && (
            <span className="max-w-[220px] truncate text-sm text-muted-foreground">
              {devices[0].label || t("defaultMicrophone")}
            </span>
          )}
        </div>

        {/* Right: status + waveform */}
        <div className="flex items-center gap-3">
          {state === "recording" && (
            <span className="flex items-center gap-2 text-sm font-medium text-destructive">
              <span className="inline-block size-1.5 animate-pulse rounded-full bg-destructive" />
              {t("recordingStatus")} {formatDuration(duration)}
            </span>
          )}

          {state === "paused" && (
            <span className="flex items-center gap-2 text-sm font-medium text-status-to_review">
              <span className="inline-block size-1.5 rounded-full bg-status-to_review" />
              {t("pausedStatus")} {formatDuration(duration)}
            </span>
          )}

          {state === "idle" && (
            <span
              className={cn(
                "text-sm font-medium",
                hasTranscript || hasRecording
                  ? "text-status-completed"
                  : "text-status-completed"
              )}
            >
              {hasTranscript
                ? t("transcribed")
                : hasRecording
                  ? t("recorded")
                  : t("ready")}
            </span>
          )}

          <div
            className={cn("h-9 w-40", waveformActive && "text-foreground")}
          >
            <LiveWaveform
              active={waveformActive}
              deviceId={selectedDeviceId || undefined}
              height={36}
              barWidth={2}
              barGap={1}
              barRadius={1}
              barHeight={3}
              sensitivity={1.5}
              mode="static"
              fadeEdges
              fadeWidth={16}
              onError={
                (() => {
                  /* mic errors handled by device enumeration */
                }) as LiveWaveformProps["onError"]
              }
            />
          </div>
        </div>
      </div>
    );
  }
);
