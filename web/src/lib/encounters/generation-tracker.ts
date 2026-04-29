import type { NoteSection } from "@/lib/parse-note-sections";
import { emit } from "@/lib/events";

// ── Types ────────────────────────────────────────────────────────

export interface StreamingCacheEntry {
  sections: NoteSection[];
  sectionIds: string[];
  sectionLabels: Record<string, string>;
}

const STREAMING_LS_PREFIX = "meditalk:streaming:";

// ── Class ────────────────────────────────────────────────────────

export class GenerationTracker {
  private activeGenerations = new Set<string>();
  private streamingCache = new Map<string, StreamingCacheEntry>();

  /** Check if a generation is currently active for this visit. */
  isActive(visitId: string): boolean {
    return this.activeGenerations.has(visitId);
  }

  /** Mark a generation as active. Returns false if already active (no-op). */
  start(visitId: string): boolean {
    if (this.activeGenerations.has(visitId)) return false;
    this.activeGenerations.add(visitId);
    return true;
  }

  /** Mark a generation as complete: clears active + cache, emits generation-done. */
  complete(visitId: string): void {
    this.activeGenerations.delete(visitId);
    this.clearCache(visitId);
    emit("generation-done", { visitId });
  }

  /** Read streaming cache: memory first (SPA nav), then localStorage (page refresh). */
  getCache(visitId: string): StreamingCacheEntry | null {
    const cached = this.streamingCache.get(visitId);
    if (cached) return cached;

    try {
      const stored = localStorage.getItem(STREAMING_LS_PREFIX + visitId);
      if (stored) {
        const parsed = JSON.parse(stored) as StreamingCacheEntry;
        if (parsed.sectionIds?.length > 0) return parsed;
      }
    } catch {
      // localStorage unavailable or corrupt
    }
    return null;
  }

  /** Update cache in memory + localStorage + emit streaming-update. */
  updateCache(visitId: string, update: Partial<StreamingCacheEntry>): void {
    const current = this.streamingCache.get(visitId) || {
      sections: [],
      sectionIds: [],
      sectionLabels: {},
    };
    const updated = { ...current, ...update };
    this.streamingCache.set(visitId, updated);

    try {
      localStorage.setItem(
        STREAMING_LS_PREFIX + visitId,
        JSON.stringify(updated),
      );
    } catch {
      // localStorage full or unavailable — non-critical
    }

    emit("streaming-update", { visitId, ...updated });
  }

  /** Clear streaming cache from both memory and localStorage. */
  clearCache(visitId: string): void {
    this.streamingCache.delete(visitId);
    try {
      localStorage.removeItem(STREAMING_LS_PREFIX + visitId);
    } catch {
      // non-critical
    }
  }

  /** @internal — only for tests */
  _reset(): void {
    this.activeGenerations.clear();
    this.streamingCache.clear();
  }
}

/** Singleton used across the app. */
export const generationTracker = new GenerationTracker();
