"use client";

import { useState, useCallback } from "react";

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
    const response = await fetch(`/api/encounters/${visitId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metadata: {
          ...metadata,
          recording_consent: true,
          recording_consent_date: new Date().toISOString(),
        },
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to save consent");
    }

    setHasConsent(true);
    setShowConsentDialog(false);
  }, [visitId, metadata]);

  return {
    showConsentDialog,
    setShowConsentDialog,
    hasConsent,
    checkConsentBeforeRecording,
    saveConsent,
  };
}
