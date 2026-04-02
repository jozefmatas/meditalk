import type { EncounterStatus } from "@/lib/types";

/** Normalize legacy DB statuses to current values. */
export function normalizeStatus(status: string): EncounterStatus {
  if (status === "draft") return "started";
  if (status === "review") return "to_review";
  if (status === "closed" || status === "completed") return "completed";
  return status as EncounterStatus;
}
