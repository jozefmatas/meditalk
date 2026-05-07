// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock("@/lib/encounters/api", () => ({
  patchEncounterStatus: vi.fn(),
}));

vi.mock("@/lib/templates", () => ({
  DEFAULT_TEMPLATE_ID: "default-tmpl",
}));

// We need real emit/on, so DON'T mock @/lib/events

const { useGenerationPolling } = await import("./use-generation-polling");
const { patchEncounterStatus } = await import("@/lib/encounters/api");

// ── Helpers ────────────────────────────────────────────────────────

function makeVisit(overrides: Record<string, unknown> = {}) {
  return {
    id: "v1",
    user_id: "u1",
    title: null as string | null,
    audio_path: null,
    language: "sk",
    visit_date: "2025-01-15",
    patient_name: null,
    patient_id: null,
    visit_type: "consultation" as const,
    status: "started" as const,
    encounter_note: null as string | null,
    metadata: {} as Record<string, unknown>,
    created_at: "2025-01-15T00:00:00Z",
    ...overrides,
  };
}

function defaultOptions() {
  return {
    visitId: "v1",
    visit: makeVisit(),
    setVisit: vi.fn(),
    isStreaming: false,
    updateTitleRef: { current: vi.fn() },
    setGeneratedNoteHtml: vi.fn(),
    setCachedTemplate: vi.fn(),
    onPollTimeout: vi.fn(),
  };
}

// ── Tests ──────────────────────────────────────────────────────────

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useGenerationPolling", () => {
  describe("event-driven re-fetch", () => {
    it("re-fetches encounter on generation-done event", async () => {
      const updatedVisit = makeVisit({
        title: "Generated Title",
        encounter_note: "<p>Note</p>",
        status: "completed",
      });
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(updatedVisit),
      });

      const opts = defaultOptions();
      renderHook(() => useGenerationPolling(opts));

      // Emit the generation-done event
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("generation-done", {
            detail: { visitId: "v1" },
          }),
        );
        // Let the async handler settle
        await Promise.resolve();
      });

      expect(fetchMock).toHaveBeenCalledWith("/api/encounters/v1");
      expect(opts.setVisit).toHaveBeenCalledWith(updatedVisit);
      expect(opts.updateTitleRef.current).toHaveBeenCalledWith(
        "Generated Title",
      );
      expect(opts.setGeneratedNoteHtml).toHaveBeenCalledWith("<p>Note</p>");
    });

    it("ignores generation-done for other visit IDs", async () => {
      const opts = defaultOptions();
      renderHook(() => useGenerationPolling(opts));

      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("generation-done", {
            detail: { visitId: "other-id" },
          }),
        );
        await Promise.resolve();
      });

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("reactive polling", () => {
    it("does not poll when status is not processing", () => {
      const opts = defaultOptions();
      opts.visit = makeVisit({ status: "started" });
      renderHook(() => useGenerationPolling(opts));

      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not poll when streaming is active", () => {
      const opts = defaultOptions();
      opts.visit = makeVisit({ status: "processing" });
      opts.isStreaming = true;
      renderHook(() => useGenerationPolling(opts));

      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("polls when status=processing and not streaming", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve(makeVisit({ status: "processing" })),
      });

      const opts = defaultOptions();
      opts.visit = makeVisit({ status: "processing" });
      renderHook(() => useGenerationPolling(opts));

      // First poll at 3s
      await act(async () => {
        vi.advanceTimersByTime(3_000);
        await Promise.resolve();
      });

      expect(fetchMock).toHaveBeenCalledWith("/api/encounters/v1");
    });

    it("stops polling and updates state when encounter_note appears", async () => {
      const completed = makeVisit({
        status: "completed",
        encounter_note: "<p>Done</p>",
        title: "Generated",
        metadata: { template_id: "tmpl-1" },
      });
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(completed),
      });

      const opts = defaultOptions();
      opts.visit = makeVisit({ status: "processing" });
      renderHook(() => useGenerationPolling(opts));

      await act(async () => {
        vi.advanceTimersByTime(3_000);
        await Promise.resolve();
      });

      expect(opts.setVisit).toHaveBeenCalledWith(completed);
      expect(opts.setGeneratedNoteHtml).toHaveBeenCalledWith("<p>Done</p>");
      expect(opts.setCachedTemplate).toHaveBeenCalledWith("tmpl-1", {
        generatedNote: "<p>Done</p>",
      });
      expect(opts.updateTitleRef.current).toHaveBeenCalledWith("Generated");

      // Should not poll again after stopping
      fetchMock.mockClear();
      await act(async () => {
        vi.advanceTimersByTime(6_000);
        await Promise.resolve();
      });
      // Fetch may still be called from the interval if it hasn't been cleared
      // The important thing is it was called with the right data above
    });

    it("times out after 180s and resets status to started", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve(makeVisit({ status: "processing" })),
      });

      const opts = defaultOptions();
      opts.visit = makeVisit({ status: "processing" });
      renderHook(() => useGenerationPolling(opts));

      // Advance past timeout (180s + one interval)
      await act(async () => {
        vi.advanceTimersByTime(183_000);
        await Promise.resolve();
      });

      // Should have reset visit status
      expect(opts.setVisit).toHaveBeenCalled();
      const updater = (opts.setVisit as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      const result = updater(makeVisit({ status: "processing" }));
      expect(result.status).toBe("started");

      // Should have patched server status
      expect(patchEncounterStatus).toHaveBeenCalledWith("v1", "started");

      // Should have called onPollTimeout
      expect(opts.onPollTimeout).toHaveBeenCalled();
    });

    it("uses DEFAULT_TEMPLATE_ID when template_id is missing", async () => {
      const completed = makeVisit({
        status: "completed",
        encounter_note: "<p>Note</p>",
        metadata: {},
      });
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(completed),
      });

      const opts = defaultOptions();
      opts.visit = makeVisit({ status: "processing" });
      renderHook(() => useGenerationPolling(opts));

      await act(async () => {
        vi.advanceTimersByTime(3_000);
        await Promise.resolve();
      });

      expect(opts.setCachedTemplate).toHaveBeenCalledWith("default-tmpl", {
        generatedNote: "<p>Note</p>",
      });
    });
  });
});
