"use client";

import { useState, useRef, useCallback } from "react";

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

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  /**
   * Start recording from a given MediaStream (e.g. from LiveWaveform's onStreamReady).
   * If no stream is provided, requests the microphone directly.
   */
  const start = useCallback(
    async (externalStream?: MediaStream) => {
      try {
        setError(null);
        setAudioBlob(null);
        setDuration(0);

        if (audioUrl) {
          URL.revokeObjectURL(audioUrl);
          setAudioUrl(null);
        }

        const stream =
          externalStream ??
          (await navigator.mediaDevices.getUserMedia({ audio: true }));
        streamRef.current = externalStream ? null : stream; // only own streams we created

        const mimeType = getSupportedMimeType();
        const recorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = recorder;
        chunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunksRef.current.push(e.data);
          }
        };

        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          const url = URL.createObjectURL(blob);
          setAudioBlob(blob);
          setAudioUrl(url);

          // Only stop tracks we own (not external streams)
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
          }
        };

        recorder.start(1000);
        setIsRecording(true);

        // Duration timer
        const startTime = Date.now();
        timerRef.current = setInterval(() => {
          setDuration(Math.floor((Date.now() - startTime) / 1000));
        }, 1000);
      } catch {
        setError("microphone_error");
      }
    },
    [audioUrl],
  );

  const stop = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isRecording]);

  const reset = useCallback(() => {
    if (isRecording) stop();

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }

    setAudioBlob(null);
    setAudioUrl(null);
    setDuration(0);
    setError(null);
  }, [isRecording, audioUrl, stop]);

  return {
    isRecording,
    audioBlob,
    audioUrl,
    duration,
    error,
    start,
    stop,
    reset,
  };
}
