"use client";

import { Button } from "@/components/shared/button";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

interface NoteActionButtonsProps {
  /** Icon for the email button (cycles by emailStatus). */
  emailIcon: IconSvgElement;
  /** Localised email button label (changes by emailStatus). */
  emailLabel: string;
  /** Email send lifecycle state — drives spinner + disabled. */
  emailStatus: "idle" | "sending" | "sent" | "failed";
  /** Whether there's a note to act on (disables both buttons when false). */
  hasNote: boolean;
  /** Whether the note was just copied — toggles copy button label. */
  noteCopied: boolean;
  /** Localised "Copy note" label. */
  copyLabel: string;
  /** Localised "Copied!" label shown after copy. */
  copiedLabel: string;
  onSendEmail: () => void;
  onCopyNote: () => void;
  /** Stretch each button to share the row equally (mobile). */
  fullWidth?: boolean;
}

/**
 * Email + Copy buttons rendered next to the note. Used in both mobile and
 * desktop review layouts; mobile passes `fullWidth` so buttons split 50/50.
 */
export function NoteActionButtons({
  emailIcon,
  emailLabel,
  emailStatus,
  hasNote,
  noteCopied,
  copyLabel,
  copiedLabel,
  onSendEmail,
  onCopyNote,
  fullWidth,
}: NoteActionButtonsProps) {
  const buttonClass = fullWidth ? "flex-1" : undefined;
  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="lg"
        className={buttonClass}
        onClick={onSendEmail}
        disabled={!hasNote || emailStatus === "sending"}
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
        className={buttonClass}
        onClick={onCopyNote}
        disabled={!hasNote}
      >
        {noteCopied ? copiedLabel : copyLabel}
      </Button>
    </div>
  );
}
