"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useLocalizedHref } from "@/hooks/use-localized-href";
import { emit } from "@/lib/events";

export function useCreateEncounter() {
  const router = useRouter();
  const locale = useLocale();
  const getHref = useLocalizedHref();
  const [isCreating, setIsCreating] = useState(false);

  const createEncounter = useCallback(
    async (templateId?: string) => {
      setIsCreating((current) => {
        if (current) return current; // Already creating, do nothing
        return true;
      });

      try {
        const res = await fetch("/api/encounters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            language: locale,
            ...(templateId ? { metadata: { template_id: templateId } } : {}),
          }),
        });

        if (!res.ok) throw new Error("Failed to create encounter");

        const encounter = await res.json();
        // Notify sidebar to add the new encounter immediately
        emit("sidebar-refresh", { encounter });
        router.push(getHref(`/encounters/${encounter.id}`));
      } catch {
        // Let the caller handle errors if needed, but don't block UI
        setIsCreating(false);
      }
    },
    [locale, router, getHref],
  );

  return { createEncounter, isCreating };
}
