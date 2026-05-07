"use client";

import { Button } from "@/components/shared/button";
import { TextShimmer } from "@/components/shared/text-shimmer";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Mail01Icon,
  Tick02Icon,
  Loading03Icon,
  AlertCircleIcon,
} from "@hugeicons/core-free-icons";

type EmailStatus = "idle" | "sending" | "sent" | "failed";

interface NoteActionButtonsProps {
  isStreaming: boolean;
  streamingLabel: string;
  generatedNoteHtml: string;
  noteCopied: boolean;
  emailStatus: EmailStatus;
  onCopy: () => void;
  onSendEmail: () => void;
  copyLabel: string;
  copiedLabel: string;
  emailLabel: string;
}

export function NoteActionButtons({
  isStreaming,
  streamingLabel,
  generatedNoteHtml,
  noteCopied,
  emailStatus,
  onCopy,
  onSendEmail,
  copyLabel,
  copiedLabel,
  emailLabel,
}: NoteActionButtonsProps) {
  if (isStreaming) {
    return (
      <TextShimmer className="text-sm tabular-nums" duration={3}>
        {streamingLabel}
      </TextShimmer>
    );
  }

  const emailIcon =
    emailStatus === "sending"
      ? Loading03Icon
      : emailStatus === "sent"
        ? Tick02Icon
        : emailStatus === "failed"
          ? AlertCircleIcon
          : Mail01Icon;

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="lg"
        onClick={onSendEmail}
        disabled={!generatedNoteHtml || emailStatus === "sending"}
      >
        <HugeiconsIcon
          icon={emailIcon}
          size={16}
          className={emailStatus === "sending" ? "animate-spin" : undefined}
        />
        {emailLabel}
      </Button>
      <Button
        variant="secondary"
        size="lg"
        onClick={onCopy}
        disabled={!generatedNoteHtml}
      >
        {noteCopied ? copiedLabel : copyLabel}
      </Button>
    </div>
  );
}
