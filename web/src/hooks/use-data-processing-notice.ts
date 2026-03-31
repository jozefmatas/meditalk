"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Hook for managing the one-time data processing notice shown during user onboarding.
 * Checks if the user has accepted the data processing notice via Supabase user_metadata.
 */
export function useDataProcessingNotice() {
  const [showNotice, setShowNotice] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    async function checkAcceptance() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user && !user.user_metadata?.data_processing_accepted) {
        setShowNotice(true);
      }

      setIsLoading(false);
    }

    checkAcceptance();
  }, [supabase.auth]);

  const accept = async () => {
    await supabase.auth.updateUser({
      data: {
        data_processing_accepted: true,
        data_processing_accepted_at: new Date().toISOString(),
      },
    });
    setShowNotice(false);
  };

  return { showNotice, accept, isLoading };
}
