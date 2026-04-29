"use client";

import { useState, useCallback } from "react";
import { patchEncounterOrThrow } from "@/lib/encounters/api";

interface RecordingConsentMetadata {
  recording_consent?: boolean;
  recording_consent_date?: string;
}

export function useRecordingConsent(
  visitId: string,
  metadata: RecordingConsentMetadata | undefined,
) {
  const [showConsentDialog, setShowConsentDialog] = useState(false);
  const [hasConsent, setHasConsent] = useState(
    metadata?.recording_consent === true,
  );

  const checkConsentBeforeRecording = useCallback(
    (onProceed: () => void) => {
      if (hasConsent) {
        // Already have consent, proceed immediately
        onProceed();
      } else {
        // Show consent dialog first
        setShowConsentDialog(true);
        // Store the callback to execute after consent
        return { waitingForConsent: true, onProceed };
      }
    },
    [hasConsent],
  );

  const saveConsent = useCallback(async () => {
    await patchEncounterOrThrow(visitId, {
      metadata: {
        recording_consent: true,
        recording_consent_date: new Date().toISOString(),
      },
    });

    setHasConsent(true);
    setShowConsentDialog(false);
  }, [visitId]);

  return {
    showConsentDialog,
    setShowConsentDialog,
    hasConsent,
    checkConsentBeforeRecording,
    saveConsent,
  };
}
