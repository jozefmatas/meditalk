"use client";

import {
  useState,
  useEffect,
  useRef,
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
import { useAudioDevices } from "@/components/encounters/hooks/use-audio-devices";
import { useRecordingGuards } from "@/components/encounters/hooks/use-recording-guards";
import {
  useAudioRecorder,
  audioMimeToExt,
} from "@/components/encounters/hooks/use-audio-recorder";
import { uploadToStorage } from "@/lib/supabase/upload";
import { transcribeBlob } from "@/components/encounters/hooks/transcribe-blob";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { isNative } from "@/lib/platform";
import type { SupportedLanguage } from "@/lib/types";

type RecordingState = "idle" | "recording" | "paused";

/** Persisted to visits.metadata.recording_session */
interface RecordingSession {
  state: "recording" | "paused";
  durationAtPause: number;
  audioPath?: string;
}

export interface RecordingBarRef {
  /** Stop recorder and return blob + whether this is a restored session. */
  finalize: () => Promise<{ blob: Blob | null; isRestoredSession: boolean }>;
}

interface RecordingBarProps {
  disabled?: boolean;
  onRecordingComplete: (blob: Blob) => void;
  onRecordingStateChange?: (state: RecordingState) => void;
  templateId?: string;
  onTemplateChange?: (id: string) => void;
  visitId: string;
  metadata?: Record<string, unknown>;
  /** Language for pause-time transcription (e.g. "sk", "en", "cs"). */
  language?: SupportedLanguage;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Re-export for external consumers
export { audioMimeToExt } from "@/components/encounters/hooks/use-audio-recorder";

export const RecordingBar = forwardRef<RecordingBarRef, RecordingBarProps>(
  function RecordingBar(
    {
      disabled,
      onRecordingStateChange,
      templateId,
      onTemplateChange,
      visitId,
      metadata,
      language,
    },
    ref,
  ) {
    const t = useTranslations("encounters.detail");

    // Tracks whether the user has started a fresh recording in this mount
    const [freshRecordingStarted, setFreshRecordingStarted] = useState(false);
    // Duration offset from a restored session (so timer continues where it left off)
    const [durationOffset, setDurationOffset] = useState(0);
    // Whether a blob upload / session persist is in-flight
    const [isPersisting, setIsPersisting] = useState(false);

    // Extract restored session from metadata (derived values computed after recorder)
    const restoredSession = metadata?.recording_session as
      | RecordingSession
      | undefined;

    // Recording consent hook
    const consentMetadata = metadata as
      | { recording_consent?: boolean; recording_consent_date?: string }
      | undefined;
    const { showConsentDialog, setShowConsentDialog, saveConsent } =
      useRecordingConsent(visitId, consentMetadata);

    // Device selection
    const { devices, selectedDeviceId, selectDevice } = useAudioDevices();

    // Audio recorder — MediaRecorder lifecycle, segments, timer
    const recorder = useAudioRecorder();

    // Derive restored-paused from metadata + recorder state (no setState in effects)
    const restoredPaused =
      !freshRecordingStarted &&
      restoredSession?.state === "paused" &&
      recorder.state === "idle";
    const restoredDuration = restoredSession?.durationAtPause ?? 0;

    // Recording guards — navigation, wake lock, notifications
    // Block navigation when actively recording OR when a blob upload is in-flight
    const {
      navDialogOpen,
      closeNavDialog,
      confirmLeave,
      acquireWakeLock,
      releaseWakeLock,
      showRecordingNotification,
      closeRecordingNotification,
      audioInterrupted,
    } = useRecordingGuards(
      recorder.state === "recording" || isPersisting,
      async () => {
        // Auto-pause + persist before navigating away
        await recorder.pause();
        await persistBlobAtPause();
        onRecordingStateChange?.("paused");
      },
    );

    // Keep latest hook values in refs so mount-only effects don't go stale
    const recorderRef = useRef(recorder);
    useEffect(() => {
      recorderRef.current = recorder;
    });

    // Clean up all resources on unmount (e.g. navigating between encounters)
    useEffect(() => {
      return () => {
        recorderRef.current.cleanupOnUnmount();
        releaseWakeLock();
        closeRecordingNotification();
      };
    }, [releaseWakeLock, closeRecordingNotification]);

    // Auto-pause/resume on phone call interruption
    const wasInterruptedRef = useRef(false);
    useEffect(() => {
      if (audioInterrupted && recorder.state === "recording") {
        wasInterruptedRef.current = true;
        recorder.pause();
        logger.info(
          "[recording] Auto-paused due to audio interruption (phone call?)",
        );
        onRecordingStateChange?.("paused");
      } else if (
        !audioInterrupted &&
        wasInterruptedRef.current &&
        recorder.state === "paused"
      ) {
        wasInterruptedRef.current = false;
        recorder.resume();
        logger.info("[recording] Auto-resumed after audio interruption ended");
        onRecordingStateChange?.("recording");
      }
    }, [audioInterrupted, recorder, onRecordingStateChange]);

    // Session restore: notify parent on mount when we have a paused session
    const sessionRestoredRef = useRef(false);
    useEffect(() => {
      if (sessionRestoredRef.current) return;
      if (restoredSession?.state === "paused") {
        sessionRestoredRef.current = true;
        onRecordingStateChange?.("paused");
        logger.debug(
          `[recording] Restored paused session: duration=${restoredSession.durationAtPause}s, audioPath=${restoredSession.audioPath ?? "none"}`,
        );
      }
    }, [restoredSession, onRecordingStateChange]);

    // ── Blob upload at pause ──

    /** Upload the current recording snapshot to storage, persist session metadata,
     *  and fire-and-forget transcription that saves to raw_text. */
    const persistBlobAtPause = async () => {
      const snapshot = recorderRef.current.getSnapshotBlob();
      if (!snapshot) return;

      setIsPersisting(true);
      try {
        const ext = audioMimeToExt(snapshot.type);
        const { path } = await uploadToStorage(snapshot, `recording${ext}`, {
          encounterId: visitId,
        });

        await fetch(`/api/encounters/${visitId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            metadata: {
              recording_session: {
                state: "paused",
                durationAtPause: durationOffset + recorderRef.current.duration,
                audioPath: path,
              } satisfies RecordingSession,
            },
          }),
        });

        logger.debug(`[recording] Blob uploaded at pause: ${path}`);

        // Fire-and-forget: transcribe the cumulative blob and save to
        // metadata.transcript. Within a session the blob is cumulative (native
        // pause/resume = single container), so each pause transcription replaces
        // the previous transcript.
        if (language) {
          transcribeBlob(snapshot, language, visitId)
            .then((text) => {
              if (!text) return;
              fetch(`/api/encounters/${visitId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ metadata: { transcript: text } }),
              }).catch(() => {
                toast.error(t("transcriptSaveFailed"));
              });
              logger.debug(
                `[recording] Pause-time transcription saved: ${text.length} chars`,
              );
            })
            .catch(() => {
              toast.error(t("transcriptSaveFailed"));
            });
        }
      } catch (err) {
        logger.warn("[recording] Blob upload at pause failed:", err);
        toast.error(t("pauseSaveFailed"));
      } finally {
        setIsPersisting(false);
      }
    };

    // ── Finalize (exposed via ref) ──

    useImperativeHandle(
      ref,
      () => ({
        finalize: async () => {
          const rec = recorderRef.current;

          // Stop recorder and get merged blob
          const blob = await rec.stop();
          logger.debug(
            `[recording] finalize() — blob: ${blob?.size || 0} bytes`,
          );

          // Clean up guards + reset recorder state
          releaseWakeLock();
          closeRecordingNotification();
          rec.reset();

          // durationOffset > 0 means user resumed a restored session (after
          // page refresh). The prior recording's transcript is already in
          // raw_text from a previous pause-time transcription, and audioPath
          // points to the prior blob. The server should concatenate both.
          return { blob, isRestoredSession: durationOffset > 0 };
        },
      }),
      [releaseWakeLock, closeRecordingNotification, durationOffset],
    );

    // ── Actions (no manual useCallback — React Compiler handles memoization) ──

    const startRecordingFlow = async () => {
      // Mark session as owned by this mount — prevent the restore effect from
      // firing when persistSession updates server-side metadata that later
      // flows back into restoredSession on a re-fetch.
      sessionRestoredRef.current = true;

      if (isNative) {
        await recorder.start();
        acquireWakeLock();
        onRecordingStateChange?.("recording");
      } else {
        const stream = await recorder.start({ deviceId: selectedDeviceId });
        if (!stream) return;

        acquireWakeLock();
        await showRecordingNotification();
        onRecordingStateChange?.("recording");
      }
    };

    const handleStart = () => {
      if (metadata?.recording_consent === true) {
        startRecordingFlow();
      } else {
        setShowConsentDialog(true);
      }
    };

    const handlePause = async () => {
      await recorder.pause();
      // Upload blob snapshot and persist session metadata
      await persistBlobAtPause();

      if (!isNative) {
        closeRecordingNotification();
      }

      onRecordingStateChange?.("paused");
    };

    const handleResume = async () => {
      if (restoredPaused) {
        // Resuming from a restored session — need fresh mic stream
        // Carry the restored duration as offset so timer continues where it left off
        setDurationOffset(restoredDuration);
        setFreshRecordingStarted(true);

        if (isNative) {
          await recorder.start();
          acquireWakeLock();
        } else {
          const stream = await recorder.start({
            deviceId: selectedDeviceId,
          });
          if (!stream) return;
          acquireWakeLock();
          await showRecordingNotification();
        }
        onRecordingStateChange?.("recording");
        return;
      }

      recorder.resume();

      if (!isNative) {
        showRecordingNotification();
      }

      onRecordingStateChange?.("recording");
    };

    // ── Shared UI elements ──

    const navGuardDialog = (
      <Dialog
        open={navDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeNavDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("leaveWhileRecordingTitle")}</DialogTitle>
            <DialogDescription>
              {t("leaveWhileRecordingDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={closeNavDialog}>
              {t("leaveWhileRecordingStay")}
            </Button>
            <Button variant="destructive" onClick={confirmLeave}>
              {t("leaveWhileRecordingLeave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );

    const deviceSelector =
      devices.length > 1 ? (
        <Select
          value={selectedDeviceId}
          onValueChange={selectDevice}
          disabled={recorder.state === "recording" || !!disabled}
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

    // ── Render ──

    // Effective display duration: restored → persisted value; active → offset + recorder timer
    const displayDuration = restoredPaused
      ? restoredDuration
      : durationOffset + recorder.duration;

    /* ── Idle: template selector (left) | mic + start button (right) ── */
    if (recorder.state === "idle" && !restoredPaused) {
      return (
        <div className="flex flex-col gap-3 desktop:flex-row desktop:items-center desktop:justify-between desktop:gap-4">
          {templateId !== undefined && onTemplateChange && (
            <TemplateSelector
              value={templateId}
              onChange={onTemplateChange}
              disabled={!!disabled}
              size="lg"
              label={t("templateLabel")}
              className="w-full desktop:w-auto desktop:max-w-xs"
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
          {recorder.micError && (
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
    if (recorder.state === "recording") {
      return (
        <>
          <div className="flex flex-col gap-3 desktop:flex-row desktop:items-center desktop:justify-between desktop:gap-4">
            <div className="h-9 min-w-0 max-w-full flex-1 text-foreground desktop:max-w-90">
              <LiveWaveform
                active
                stream={recorder.recordingStream}
                level={isNative ? recorder.nativeLevel : undefined}
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
                {t("recordingStatus")} {formatDuration(displayDuration)}
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
                {t("pausedStatus")} {formatDuration(displayDuration)}
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
      </>
    );
  },
);
