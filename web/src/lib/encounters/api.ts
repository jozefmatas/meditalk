import type { UpdateEncounterRequest, EncounterStatus } from "@/lib/types";
import { emit } from "@/lib/events";

/**
 * Fire-and-forget PATCH to /api/encounters/:id.
 * Returns the Response on success, null on network failure.
 */
export async function patchEncounter(
  visitId: string,
  patch: UpdateEncounterRequest,
): Promise<Response | null> {
  try {
    return await fetch(`/api/encounters/${visitId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  } catch {
    return null;
  }
}

/**
 * PATCH + emit("encounter-update") in a single call.
 * Covers the common pattern of updating status and notifying the sidebar.
 */
export async function patchEncounterStatus(
  visitId: string,
  status: EncounterStatus,
  extraPatch?: Omit<UpdateEncounterRequest, "status">,
): Promise<Response | null> {
  emit("encounter-update", { id: visitId, status });
  return patchEncounter(visitId, { status, ...extraPatch });
}

/**
 * PATCH that throws on failure — for callers that need error propagation.
 */
export async function patchEncounterOrThrow(
  visitId: string,
  patch: UpdateEncounterRequest,
): Promise<Response> {
  const res = await fetch(`/api/encounters/${visitId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(`Failed to update encounter: ${res.status}`);
  }
  return res;
}
