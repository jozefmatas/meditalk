import type { Encounter, EncounterStatus } from "@/lib/types";
import type { NoteSection } from "@/lib/parse-note-sections";

// ── Event payload map ────────────────────────────────────────────

export interface CustomEventMap {
  "encounter-update": {
    id: string;
    status?: EncounterStatus;
    title?: string | null;
  };
  "encounter-delete": { id: string };
  "sidebar-refresh": { encounter: Encounter };
  "streaming-update": {
    visitId: string;
    sections: NoteSection[];
    sectionIds: string[];
    sectionLabels: Record<string, string>;
  };
  "generation-done": { visitId: string };
  "extraction-complete": { visitId: string; fileId: string };
}

// ── Typed helpers ────────────────────────────────────────────────

/** Dispatch a typed custom event on `window`. */
export function emit<K extends keyof CustomEventMap>(
  name: K,
  payload: CustomEventMap[K],
): void {
  window.dispatchEvent(new CustomEvent(name, { detail: payload }));
}

/**
 * Listen for a typed custom event on `window`.
 * Returns a cleanup function suitable for `useEffect` teardown.
 */
export function on<K extends keyof CustomEventMap>(
  name: K,
  handler: (payload: CustomEventMap[K]) => void,
): () => void {
  const listener = (e: Event) => {
    handler((e as CustomEvent<CustomEventMap[K]>).detail);
  };
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}
