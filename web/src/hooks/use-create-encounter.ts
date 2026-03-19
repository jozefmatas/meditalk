"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useLocalizedHref } from "@/hooks/use-localized-href";

export function useCreateEncounter() {
  const router = useRouter();
  const locale = useLocale();
  const getHref = useLocalizedHref();
  const [isCreating, setIsCreating] = useState(false);

  const createEncounter = async (templateId?: string) => {
    if (isCreating) return;
    setIsCreating(true);

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
      window.dispatchEvent(
        new CustomEvent("sidebar-refresh", { detail: { encounter } }),
      );
      router.push(getHref(`/encounters/${encounter.id}`));
    } catch {
      // Let the caller handle errors if needed, but don't block UI
      setIsCreating(false);
    }
  };

  return { createEncounter, isCreating };
}
