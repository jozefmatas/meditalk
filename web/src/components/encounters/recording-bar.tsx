"use client";

import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
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
import { useAudioRecorder } from "@/components/encounters/hooks/use-audio-recorder";
import { useScribeStreaming } from "@/components/encounters/hooks/use-scribe-streaming";
import { logger } from "@/lib/logger";
import { isNative } from "@/lib/platform";

type RecordingState = "idle" | "recording" | "paused";

export interface RecordingBarRef {
  /** Stop recorder + Scribe stream, return blob and transcript. */
  finalize: () => Promise<{
    blob: Blob | null;
    transcript: string | null;
  }>;
}

interface RecordingBarProps {
  disabled?: boolean;
  onRecordingComplete: (blob: Blob) => void;
  onRecordingStateChange?: (state: RecordingState) => void;
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
      language,
      metadata,
    },
    ref,
  ) {
    const t = useTranslations("encounters.detail");

    // Recording consent hook
    const { showConsentDialog, setShowConsentDialog, saveConsent } =
      useRecordingConsent(visitId, metadata);

    // Device selection
    const { devices, selectedDeviceId, selectDevice } = useAudioDevices();

    // Audio recorder — MediaRecorder lifecycle, segments, timer
    const recorder = useAudioRecorder();

    // Scribe — real-time transcription via WebSocket
    const scribe = useScribeStreaming(language);

    // Recording guards — navigation, wake lock, notifications
    const {
      navDialogOpen,
      closeNavDialog,
      confirmLeave,
      acquireWakeLock,
      releaseWakeLock,
      showRecordingNotification,
      closeRecordingNotification,
      audioInterrupted,
      setAudioContext,
    } = useRecordingGuards(recorder.state !== "idle");

    // Keep latest hook values in refs so mount-only effects don't go stale
    const recorderRef = useRef(recorder);
    const scribeRef = useRef(scribe);
    useEffect(() => {
      recorderRef.current = recorder;
      scribeRef.current = scribe;
    });

    // Clean up all resources on unmount (e.g. navigating between encounters)
    useEffect(() => {
      return () => {
        recorderRef.current.cleanupOnUnmount();
        scribeRef.current.stopScribe();
        releaseWakeLock();
        closeRecordingNotification();
        setAudioContext(null);
      };
    }, [releaseWakeLock, closeRecordingNotification, setAudioContext]);

    // Auto-pause/resume on phone call interruption
    const wasInterruptedRef = useRef(false);
    useEffect(() => {
      if (audioInterrupted && recorder.state === "recording") {
        wasInterruptedRef.current = true;
        recorder.pause();
        scribe.stopScribe();
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

        if (isNative) {
          scribe.startScribeNative();
        } else {
          const stream = recorder.recordingStream;
          if (stream) {
            scribe.startScribe(stream).then((ctx) => {
              if (ctx) setAudioContext(ctx);
            });
          }
        }

        logger.info("[recording] Auto-resumed after audio interruption ended");
        onRecordingStateChange?.("recording");
      }
    }, [
      audioInterrupted,
      recorder,
      scribe,
      setAudioContext,
      onRecordingStateChange,
    ]);

    // ── Finalize (exposed via ref) ──

    useImperativeHandle(
      ref,
      () => ({
        finalize: async () => {
          const rec = recorderRef.current;
          const scr = scribeRef.current;

          // If actively recording, wait briefly for VAD to commit final chunks
          if (rec.state === "recording") {
            logger.debug(
              "[recording] finalize() called while recording — waiting for final transcript chunks",
            );
            await new Promise((resolve) => setTimeout(resolve, 200));
          }

          // Stop Scribe and grab transcript
          scr.stopScribe();
          const transcript = scr.consumeTranscript();
          logger.debug(
            `[recording] finalize() — transcript length: ${transcript?.length || 0} chars`,
          );

          // Stop recorder and get merged blob
          const blob = await rec.stop();

          // Clean up guards + reset recorder state
          releaseWakeLock();
          closeRecordingNotification();
          rec.reset();

          return { blob, transcript };
        },
      }),
      [releaseWakeLock, closeRecordingNotification],
    );

    // ── Actions (no manual useCallback — React Compiler handles memoization) ──

    const startRecordingFlow = async () => {
      if (isNative) {
        // Native: open Scribe WebSocket, then start native recorder
        // Chunks flow: native plugin → onNativeChunk → scribe.sendChunk
        await scribe.startScribeNative();
        await recorder.start({
          onNativeChunk: (chunk) => scribe.sendChunk(chunk),
        });

        // Android foreground service / iOS background mode
        acquireWakeLock();
        onRecordingStateChange?.("recording");
      } else {
        // Web: start MediaRecorder, pipe stream to Scribe AudioWorklet
        const stream = await recorder.start({ deviceId: selectedDeviceId });
        if (!stream) return;

        const audioCtx = await scribe.startScribe(stream);
        if (audioCtx) setAudioContext(audioCtx);

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

    const handlePause = () => {
      recorder.pause();
      scribe.stopScribe();

      if (!isNative) {
        setAudioContext(null);
        closeRecordingNotification();
      }

      onRecordingStateChange?.("paused");
    };

    const handleResume = async () => {
      if (isNative) {
        // Native: reconnect Scribe WebSocket, then resume native recorder
        await scribe.startScribeNative();
        recorder.resume();
      } else {
        // Web: resume MediaRecorder, reconnect Scribe AudioWorklet
        recorder.resume();
        const stream = recorder.recordingStream;
        if (stream) {
          const audioCtx = await scribe.startScribe(stream);
          if (audioCtx) setAudioContext(audioCtx);
        }
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

    /* ── Idle: template selector (left) | mic + start button (right) ── */
    if (recorder.state === "idle") {
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
                {t("recordingStatus")} {formatDuration(recorder.duration)}
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
                {t("pausedStatus")} {formatDuration(recorder.duration)}
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
