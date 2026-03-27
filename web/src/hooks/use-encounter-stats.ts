import { useState, useEffect } from "react";
import type { EncounterListResponse } from "@/lib/types";

const MINUTES_PER_ENCOUNTER = 6;

export type TimePeriod = "week" | "month" | "year" | "all";

export interface EncounterStats {
  count: number;
  minsSaved: number;
}

function getDateCutoff(period: TimePeriod): Date | null {
  if (period === "all") return null;

  const now = new Date();
  const cutoff = new Date(now);

  switch (period) {
    case "week":
      cutoff.setDate(now.getDate() - 7);
      break;
    case "month":
      cutoff.setDate(now.getDate() - 30);
      break;
    case "year":
      cutoff.setFullYear(now.getFullYear() - 1);
      break;
  }

  return cutoff;
}

/**
 * Fetch encounter statistics for a given time period
 */
export function useEncounterStats(period: TimePeriod = "week") {
  const [stats, setStats] = useState<EncounterStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      setIsLoading(true);

      try {
        const cutoff = getDateCutoff(period);
        let url = "/api/encounters?limit=1";

        if (cutoff) {
          url += `&after=${cutoff.toISOString()}`;
        }

        const res = await fetch(url);
        if (!res.ok) {
          throw new Error("Failed to fetch stats");
        }

        const data: EncounterListResponse = await res.json();
        const count = data.total;
        const minsSaved = count * MINUTES_PER_ENCOUNTER;

        setStats({ count, minsSaved });
      } catch {
        // Silently fail — stats are non-critical
        setStats({ count: 0, minsSaved: 0 });
      } finally {
        setIsLoading(false);
      }
    }

    fetchStats();
  }, [period]);

  return { stats, isLoading };
}
