"use client";

import { useState, useCallback, useEffect } from "react";

const CONSENT_KEY = "meditalk-cookie-consent";

export type ConsentStatus = "accepted" | "declined" | null;

export function useCookieConsent() {
  // Start with null on both server and client to avoid hydration mismatch
  const [consent, setConsentState] = useState<ConsentStatus>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from localStorage only after mount (client-side only)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CONSENT_KEY) as ConsentStatus;
      setConsentState(stored); // eslint-disable-line react-hooks/set-state-in-effect -- Necessary to avoid SSR hydration mismatch with localStorage
    } catch {
      // Ignore localStorage errors
    }
    setIsLoaded(true);
  }, []);

  const setConsent = useCallback((value: ConsentStatus) => {
    if (value === null) {
      localStorage.removeItem(CONSENT_KEY);
    } else {
      localStorage.setItem(CONSENT_KEY, value);
    }
    setConsentState(value);
  }, []);

  return {
    consent,
    setConsent,
    isLoaded,
  };
}
