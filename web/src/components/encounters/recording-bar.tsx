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
import { useRouter } from "next/navigation";
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

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shared/dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import { Mic01Icon } from "@hugeicons/core-free-icons";
import { RecordingConsentDialog } from "@/components/encounters/recording-consent-dialog";
import { useRecordingConsent } from "@/hooks/use-recording-consent";

type RecordingState = "idle" | "recording" | "paused";

export interface RecordingBarRef {
  /** Stop recorder + Scribe stream, return blob, transcript, pending ID, and segment IDs. */
  finalize: () => Promise<{
    blob: Blob | null;
    transcript: string | null;
    pendingId: string | null;
    segmentIds: string[];
  }>;
}

/** Detect if the device is Android */
function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

interface RecordingBarProps {
  disabled?: boolean;
  onRecordingComplete: (blob: Blob) => void;
  onRecordingStateChange?: (state: RecordingState) => void;
  onRecordingStart?: (pendingId: string, name: string) => void;
  templateId?: string;
  onTemplateChange?: (id: string) => void;
  visitId: string;
  language?: string;
  metadata?: {
    recording_consent?: boolean;
    recording_consent_date?: string;
  };
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
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

/** Map recording MIME type to file extension. */
export function audioMimeToExt(mime: string): string {
  if (mime.includes("mp4")) return ".m4a";
  if (mime.includes("ogg")) return ".ogg";
  return ".webm";
}

export const RecordingBar = forwardRef<RecordingBarRef, RecordingBarProps>(
  function RecordingBar(
    {
      disabled,
      onRecordingComplete,
      onRecordingStateChange,
      onRecordingStart,
      templateId,
      onTemplateChange,
      visitId,
      language,
      metadata,
    },
    ref,
  ) {
    const t = useTranslations("encounters.detail");
    const router = useRouter();

    // Recording consent hook
    const { showConsentDialog, setShowConsentDialog, saveConsent } =
      useRecordingConsent(visitId, metadata);

    const [state, setState] = useState<RecordingState>("idle");
    const [duration, setDuration] = useState(0);
    const [micError, setMicError] = useState(false);
    const [recordingStream, setRecordingStream] = useState<MediaStream | null>(
      null,
    );

    // Navigation guard state
    const [navDialogOpen, setNavDialogOpen] = useState(false);
    const pendingNavUrlRef = useRef<string | null>(null);

    // Device selection
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");

    // Stable ref for onRecordingComplete so cleanup can call it without stale closure
    const onRecordingCompleteRef = useRef(onRecordingComplete);
    onRecordingCompleteRef.current = onRecordingComplete;

    // Recording refs
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const segmentsRef = useRef<Blob[]>([]); // Accumulate recording segments from pause/resume
    const pendingRecordingIdRef = useRef<string | null>(null); // Track pending file ID for replacement
    const segmentIdsRef = useRef<string[]>([]); // Track IndexedDB segment IDs for cleanup
    const mimeTypeRef = useRef<string>("audio/webm");
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const elapsedBeforePauseRef = useRef(0);
    const recordingStartRef = useRef(0);
    const recordingStreamRef = useRef<MediaStream | null>(null);

    // Scribe streaming refs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scribeRef = useRef<any>(null);
    const scribeAudioCtxRef = useRef<AudioContext | null>(null);
    const transcriptRef = useRef<string>("");

    // Wake Lock — keeps screen on during recording (no audio interaction)
    const wakeLockRef = useRef<WakeLockSentinel | null>(null);

    // Android notification — prevents tab suspension when screen locks
    const notificationRef = useRef<Notification | null>(null);

    const acquireWakeLock = useCallback(async () => {
      if (!("wakeLock" in navigator)) return;
      try {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        wakeLockRef.current.addEventListener("release", () => {
          wakeLockRef.current = null;
        });
      } catch {
        // Failed (e.g. low battery, page not visible)
      }
    }, []);

    const releaseWakeLock = useCallback(() => {
      wakeLockRef.current?.release();
      wakeLockRef.current = null;
    }, []);

    /** Show persistent notification on Android to prevent tab suspension */
    const showRecordingNotification = useCallback(async () => {
      // Only for Android devices with Notification API support
      if (!isAndroid() || !("Notification" in window)) return;

      try {
        // Request permission if not already granted
        if (Notification.permission === "default") {
          await Notification.requestPermission();
        }

        // Create notification if permission granted
        if (Notification.permission === "granted") {
          notificationRef.current = new Notification(
            t("recordingNotificationTitle"),
            {
              body: t("recordingNotificationBody"),
              requireInteraction: true,
              icon: "/icon-192.png",
              badge: "/icon-192.png",
              tag: "meditalk-recording", // Replaces previous notification if any
            },
          );
        }
      } catch (err) {
        // Notification failed — not critical, recording will still work
        console.warn("[notification] Failed to show notification:", err);
      }
    }, [t]);

    /** Close recording notification */
    const closeRecordingNotification = useCallback(() => {
      if (notificationRef.current) {
        notificationRef.current.close();
        notificationRef.current = null;
      }
    }, []);

    // Re-acquire wake lock when page becomes visible (OS releases it on hide)
    useEffect(() => {
      const handleVisibility = () => {
        if (
          document.visibilityState === "visible" &&
          state !== "idle" &&
          !wakeLockRef.current
        ) {
          acquireWakeLock();
        }
      };
      document.addEventListener("visibilitychange", handleVisibility);
      return () =>
        document.removeEventListener("visibilitychange", handleVisibility);
    }, [state, acquireWakeLock]);

    // Prevent accidental navigation while recording is active
    useEffect(() => {
      if (state === "idle") return;

      // Tab close / page refresh — browser shows native "Leave site?" dialog
      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        e.preventDefault();
      };
      window.addEventListener("beforeunload", handleBeforeUnload);

      // Client-side link clicks — show our custom dialog instead of navigating
      const handleClick = (e: MouseEvent) => {
        const anchor = (e.target as Element).closest("a");
        if (!anchor) return;
        const href = anchor.getAttribute("href");
        if (!href || href === "#") return;
        try {
          const url = new URL(href, location.origin);
          if (
            url.origin === location.origin &&
            url.pathname !== location.pathname
          ) {
            e.preventDefault();
            e.stopPropagation();
            pendingNavUrlRef.current = href;
            setNavDialogOpen(true);
          }
        } catch {
          // invalid URL, ignore
        }
      };
      document.addEventListener("click", handleClick, true);

      return () => {
        window.removeEventListener("beforeunload", handleBeforeUnload);
        document.removeEventListener("click", handleClick, true);
      };
    }, [state]);

    const handleConfirmLeave = useCallback(() => {
      setNavDialogOpen(false);
      const url = pendingNavUrlRef.current;
      pendingNavUrlRef.current = null;
      if (url) router.push(url);
    }, [router]);

    // Clean up all resources on unmount (e.g. navigating between encounters)
    // Without this, the old MediaStream holds the mic and blocks getUserMedia on the next page
    useEffect(() => {
      return () => {
        // Stop MediaRecorder — onstop handler will build the blob and call
        // onRecordingComplete automatically (no timeslice, so data is flushed at stop)
        if (mediaRecorderRef.current?.state !== "inactive") {
          try {
            mediaRecorderRef.current?.stop();
          } catch {
            // already stopped
          }
        }
        // Release mic tracks
        recordingStreamRef.current?.getTracks().forEach((t) => t.stop());
        recordingStreamRef.current = null;
        // Clear timer
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        // Close Scribe WebSocket + AudioContext
        try {
          scribeRef.current?.close();
        } catch {
          // ignore
        }
        scribeRef.current = null;
        try {
          scribeAudioCtxRef.current?.close();
        } catch {
          // ignore
        }
        scribeAudioCtxRef.current = null;
        // Release wake lock
        wakeLockRef.current?.release();
        wakeLockRef.current = null;
        // Close notification
        closeRecordingNotification();
      };
    }, [closeRecordingNotification]);

    // Enumerate audio devices on mount (labels may be empty until permission is granted)
    useEffect(() => {
      navigator.mediaDevices
        .enumerateDevices()
        .then((allDevices) => {
          const audioInputs = allDevices.filter(
            (d) => d.kind === "audioinput" && d.deviceId !== "",
          );
          setDevices(audioInputs);
          if (audioInputs.length > 0 && !selectedDeviceId) {
            setSelectedDeviceId(audioInputs[0].deviceId);
          }
        })
        .catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /** Build blob from accumulated chunks */
    const buildBlob = useCallback(() => {
      if (chunksRef.current.length === 0) return null;
      return new Blob(chunksRef.current, { type: mimeTypeRef.current });
    }, []);

    /** Start Scribe real-time streaming in manual audio mode (shares existing mic stream) */
    const startScribe = useCallback(
      async (stream: MediaStream) => {
        try {
          const tokenRes = await fetch("/api/scribe-token", { method: "POST" });
          if (!tokenRes.ok) {
            console.warn(
              "[scribe] Token fetch failed, will fall back to batch",
            );
            return;
          }
          const { token } = await tokenRes.json();

          const { Scribe, RealtimeEvents, AudioFormat, CommitStrategy } =
            await import("@elevenlabs/client");

          // Create AudioContext to read PCM from the existing recording stream
          const audioCtx = new AudioContext();
          await audioCtx.resume(); // mobile browsers may start suspended
          scribeAudioCtxRef.current = audioCtx;
          const source = audioCtx.createMediaStreamSource(stream);

          // Map native sample rate → Scribe format (most browsers = 48 kHz)
          const rate = audioCtx.sampleRate;
          const formatMap: Partial<
            Record<number, (typeof AudioFormat)[keyof typeof AudioFormat]>
          > = {
            8000: AudioFormat.PCM_8000,
            16000: AudioFormat.PCM_16000,
            22050: AudioFormat.PCM_22050,
            24000: AudioFormat.PCM_24000,
            44100: AudioFormat.PCM_44100,
            48000: AudioFormat.PCM_48000,
          };
          const audioFormat = formatMap[rate] ?? AudioFormat.PCM_16000;
          const targetRate = formatMap[rate] ? rate : 16000;
          const needsDownsample = !formatMap[rate];

          const connection = Scribe.connect({
            token,
            modelId: "scribe_v2_realtime",
            audioFormat,
            sampleRate: targetRate,
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
              }
            },
          );

          connection.on(RealtimeEvents.ERROR, (err: unknown) => {
            // Suppress expected "1006 - No reason provided" when pausing/stopping
            const errStr = String(err);
            if (
              errStr.includes("1006") ||
              errStr.includes("No reason provided")
            ) {
              return; // Expected when closing connection (pause/stop)
            }
            console.warn("[scribe] Streaming error:", err);
          });

          // Pipe PCM from our mic stream → Scribe via ScriptProcessorNode
          const processor = audioCtx.createScriptProcessor(4096, 1, 1);
          processor.onaudioprocess = (e) => {
            const float32 = e.inputBuffer.getChannelData(0);
            let pcm: Float32Array;
            if (needsDownsample) {
              const ratio = rate / targetRate;
              const len = Math.floor(float32.length / ratio);
              pcm = new Float32Array(len);
              for (let i = 0; i < len; i++) {
                pcm[i] = float32[Math.floor(i * ratio)];
              }
            } else {
              pcm = float32;
            }
            // Float32 → Int16 PCM
            const int16 = new Int16Array(pcm.length);
            for (let i = 0; i < pcm.length; i++) {
              const s = Math.max(-1, Math.min(1, pcm[i]));
              int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            // Base64 encode and send
            const bytes = new Uint8Array(int16.buffer);
            let bin = "";
            for (let i = 0; i < bytes.length; i++) {
              bin += String.fromCharCode(bytes[i]);
            }
            try {
              connection.send({ audioBase64: btoa(bin) });
            } catch {
              // Connection closed
            }
          };

          // Connect pipeline: source → processor → silent gain (no speaker output)
          const silent = audioCtx.createGain();
          silent.gain.value = 0;
          source.connect(processor);
          processor.connect(silent);
          silent.connect(audioCtx.destination);

          scribeRef.current = connection;
        } catch (err) {
          console.warn("[scribe] Failed to start streaming:", err);
        }
      },
      [language],
    );

    /** Stop Scribe connection and audio pipeline */
    const stopScribe = useCallback(() => {
      if (scribeRef.current) {
        try {
          scribeRef.current.close();
        } catch {
          // ignore
        }
        scribeRef.current = null;
      }
      if (scribeAudioCtxRef.current) {
        try {
          scribeAudioCtxRef.current.close();
        } catch {
          // ignore
        }
        scribeAudioCtxRef.current = null;
      }
    }, []);

    // Merge all recording segments into a single blob
    const mergeSegments = useCallback((finalSegment: Blob | null) => {
      const allSegments = [...segmentsRef.current];
      if (finalSegment) allSegments.push(finalSegment);

      if (allSegments.length === 0) return null;
      if (allSegments.length === 1) return allSegments[0];

      // Merge all segments into one blob with the same MIME type
      return new Blob(allSegments, { type: mimeTypeRef.current });
    }, []);

    /** Expose finalize() so the page can stop & grab the blob + transcript */
    useImperativeHandle(
      ref,
      () => ({
        finalize: () => {
          // Stop Scribe and grab transcript
          stopScribe();
          const transcript = transcriptRef.current || null;
          transcriptRef.current = "";

          const recorder = mediaRecorderRef.current;

          // If recorder is already stopped or never started, resolve immediately
          if (!recorder || recorder.state === "inactive") {
            const blob = buildBlob();
            chunksRef.current = [];
            const mergedBlob = mergeSegments(blob);
            segmentsRef.current = []; // Clear segments

            // Capture values to return
            const pendingId = pendingRecordingIdRef.current;
            const segmentIds = [...segmentIdsRef.current];

            // Reset refs for next recording
            pendingRecordingIdRef.current = null;
            segmentIdsRef.current = [];

            // Cleanup
            if (recordingStreamRef.current) {
              recordingStreamRef.current.getTracks().forEach((t) => t.stop());
              recordingStreamRef.current = null;
              setRecordingStream(null);
            }
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
            releaseWakeLock();
            closeRecordingNotification();
            setState("idle");
            setDuration(0);
            elapsedBeforePauseRef.current = 0;
            return Promise.resolve({
              blob: mergedBlob,
              transcript,
              pendingId,
              segmentIds,
            });
          }

          // Wait for onstop to fire (ensures all data is flushed, especially
          // for mp4 which doesn't use timeslice and delivers all data at stop).
          // IMPORTANT: cleanup (mic track stop, etc.) must happen INSIDE onstop —
          // killing the stream before the recorder finalizes truncates the file.
          return new Promise<{
            blob: Blob | null;
            transcript: string | null;
            pendingId: string | null;
            segmentIds: string[];
          }>((resolve) => {
            recorder.onstop = () => {
              const blob = buildBlob();
              chunksRef.current = [];
              const mergedBlob = mergeSegments(blob);
              segmentsRef.current = []; // Clear segments

              // Capture values to return
              const pendingId = pendingRecordingIdRef.current;
              const segmentIds = [...segmentIdsRef.current];

              // Reset refs for next recording
              pendingRecordingIdRef.current = null;
              segmentIdsRef.current = [];

              // Cleanup AFTER data is fully flushed
              if (recordingStreamRef.current) {
                recordingStreamRef.current.getTracks().forEach((t) => t.stop());
                recordingStreamRef.current = null;
                setRecordingStream(null);
              }
              if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
              }
              releaseWakeLock();
              closeRecordingNotification();
              setState("idle");
              setDuration(0);
              elapsedBeforePauseRef.current = 0;
              resolve({ blob: mergedBlob, transcript, pendingId, segmentIds });
            };
            recorder.stop();
          });
        },
      }),
      [
        buildBlob,
        stopScribe,
        releaseWakeLock,
        closeRecordingNotification,
        mergeSegments,
      ],
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

    // --- Actions ---

    // Actual recording start logic (extracted from old handleStart)
    const startRecordingFlow = useCallback(async () => {
      setDuration(0);
      setMicError(false);
      elapsedBeforePauseRef.current = 0;
      transcriptRef.current = "";
      segmentsRef.current = []; // Clear segments from previous recording
      segmentIdsRef.current = []; // Clear segment IDs from previous recording

      // Generate pending file ID and notify parent
      const pendingId = crypto.randomUUID();
      pendingRecordingIdRef.current = pendingId;

      // Get actual MIME type and extension for correct display name
      const mimeType = getSupportedMimeType();
      const ext = audioMimeToExt(mimeType);
      const recordingName = `recording${ext}`;
      onRecordingStart?.(pendingId, recordingName);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: selectedDeviceId
            ? { deviceId: { exact: selectedDeviceId } }
            : true,
        });
        recordingStreamRef.current = stream;
        setRecordingStream(stream);

        mimeTypeRef.current = mimeType;
        const recorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = recorder;
        chunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunksRef.current.push(e.data);
          }
        };

        recorder.onstop = async () => {
          const blob = buildBlob();
          chunksRef.current = [];

          // Store segment in IndexedDB (encrypted) and in-memory
          if (blob) {
            segmentsRef.current.push(blob);

            // Save to IndexedDB for recovery on page refresh
            const segmentId = crypto.randomUUID();
            segmentIdsRef.current.push(segmentId);

            try {
              const { savePendingUpload } =
                await import("@/lib/indexeddb/pending-uploads");
              const ext = audioMimeToExt(mimeTypeRef.current);
              await savePendingUpload({
                id: segmentId,
                visitId,
                blob,
                name: `recording-segment-${segmentsRef.current.length}${ext}`,
                type: mimeTypeRef.current,
                size: blob.size,
                source: "recording-segment",
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error(
                "[recording] Failed to save segment to IndexedDB:",
                err,
              );
            }
          }
        };

        // No timeslice — stop() delivers a single valid file.
        // Timeslice fragments can produce malformed containers on some Android
        // devices, causing WAV conversion and ElevenLabs batch transcription
        // to fail. Scribe streaming handles real-time transcript independently.
        recorder.start();

        // Start Scribe streaming from the same mic stream (non-blocking)
        startScribe(stream);

        // Keep screen awake during recording
        acquireWakeLock();

        // Show persistent notification on Android to prevent tab suspension
        await showRecordingNotification();

        startTimer();
        setState("recording");
        onRecordingStateChange?.("recording");
      } catch (err) {
        console.warn("[recording] Mic access failed:", err);
        setMicError(true);
      }
    }, [
      selectedDeviceId,
      buildBlob,
      startTimer,
      onRecordingStateChange,
      onRecordingStart,
      startScribe,
      acquireWakeLock,
      showRecordingNotification,
      visitId,
    ]);

    // New handleStart - checks consent before recording
    const handleStart = useCallback(() => {
      // Check if we already have consent from metadata
      if (metadata?.recording_consent === true) {
        // Already have consent, start recording immediately
        startRecordingFlow();
      } else {
        // Need consent first, show dialog
        setShowConsentDialog(true);
      }
    }, [metadata, startRecordingFlow, setShowConsentDialog]);

    const handlePause = useCallback(() => {
      const recorder = mediaRecorderRef.current;
      if (recorder?.state === "recording") {
        // STOP (not pause) to finalize the current recording segment
        recorder.stop(); // This triggers onstop → blob created → onRecordingComplete
      }
      // Close Scribe on pause to avoid transcribing silence
      stopScribe();
      // Close notification on pause
      closeRecordingNotification();
      pauseTimer();
      setState("paused");
      onRecordingStateChange?.("paused");
    }, [
      pauseTimer,
      onRecordingStateChange,
      stopScribe,
      closeRecordingNotification,
    ]);

    const handleResume = useCallback(() => {
      // Start a NEW recorder for the next segment (previous one was stopped on pause)
      const stream = recordingStreamRef.current;
      if (!stream) return;

      const mimeType = mimeTypeRef.current;
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const blob = buildBlob();
        chunksRef.current = [];

        // Store segment in IndexedDB (encrypted) and in-memory
        if (blob) {
          segmentsRef.current.push(blob);

          // Save to IndexedDB for recovery on page refresh
          const segmentId = crypto.randomUUID();
          segmentIdsRef.current.push(segmentId);

          try {
            const { savePendingUpload } =
              await import("@/lib/indexeddb/pending-uploads");
            const ext = audioMimeToExt(mimeTypeRef.current);
            await savePendingUpload({
              id: segmentId,
              visitId,
              blob,
              name: `recording-segment-${segmentsRef.current.length}${ext}`,
              type: mimeTypeRef.current,
              size: blob.size,
              source: "recording-segment",
              timestamp: Date.now(),
            });
          } catch (err) {
            console.error(
              "[recording] Failed to save segment to IndexedDB:",
              err,
            );
          }
        }
      };

      recorder.start();

      // Reconnect Scribe using the existing recording stream
      startScribe(stream);
      // Re-show notification on resume
      showRecordingNotification();
      startTimer();
      setState("recording");
      onRecordingStateChange?.("recording");
    }, [
      startTimer,
      onRecordingStateChange,
      startScribe,
      buildBlob,
      showRecordingNotification,
      visitId,
    ]);

    // Navigation guard dialog — shared between recording & paused states
    const navGuardDialog = (
      <Dialog open={navDialogOpen} onOpenChange={setNavDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("leaveWhileRecordingTitle")}</DialogTitle>
            <DialogDescription>
              {t("leaveWhileRecordingDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNavDialogOpen(false)}>
              {t("leaveWhileRecordingStay")}
            </Button>
            <Button variant="destructive" onClick={handleConfirmLeave}>
              {t("leaveWhileRecordingLeave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );

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
          {templateId !== undefined && onTemplateChange && (
            <TemplateSelector
              value={templateId}
              onChange={onTemplateChange}
              disabled={!!disabled}
              size="lg"
              label={t("templateLabel")}
              className="w-full desktop:w-auto desktop:max-w-[320px]"
            />
          )}
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
          {micError && (
            <p className="text-sm text-destructive">{t("micError")}</p>
          )}

          {/* Recording consent dialog */}
          <RecordingConsentDialog
            open={showConsentDialog}
            onOpenChange={setShowConsentDialog}
            onConsent={async () => {
              await saveConsent();
              await startRecordingFlow();
            }}
          />
        </div>
      );
    }

    /* ── Recording: waveform (left) | status + pause button (right) ── */
    if (state === "recording") {
      return (
        <>
          <div className="flex flex-col gap-3 desktop:flex-row desktop:items-center desktop:justify-between desktop:gap-4">
            <div className="h-9 min-w-0 max-w-full flex-1 text-foreground desktop:max-w-90">
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
          {navGuardDialog}
        </>
      );
    }

    /* ── Paused: template selector (left) | mic + divider + status + resume button (right) ── */
    return (
      <>
        <div className="flex flex-col gap-3 desktop:flex-row desktop:items-center desktop:justify-between desktop:gap-4">
          {templateId !== undefined && onTemplateChange && (
            <TemplateSelector
              value={templateId}
              onChange={onTemplateChange}
              disabled={!!disabled}
              size="lg"
              label={t("templateLabel")}
              className="w-full desktop:w-auto desktop:max-w-70"
            />
          )}
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
        {navGuardDialog}
      </>
    );
  },
);
