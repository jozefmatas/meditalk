// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────

const mockPatchEncounterStatus = vi.fn();
vi.mock("@/lib/encounters/api", () => ({
  patchEncounterStatus: (...args: unknown[]) =>
    mockPatchEncounterStatus(...args),
}));

vi.mock("@/lib/templates", () => ({
  DEFAULT_TEMPLATE_ID: "default-template",
}));

const eventHandlers = new Map<string, Set<(detail: unknown) => void>>();
vi.mock("@/lib/events", () => ({
  emit: vi.fn((event: string, detail: unknown) => {
    eventHandlers.get(event)?.forEach((h) => h(detail));
  }),
  on: vi.fn((event: string, handler: (detail: unknown) => void) => {
    if (!eventHandlers.has(event)) eventHandlers.set(event, new Set());
    eventHandlers.get(event)!.add(handler);
    return () => eventHandlers.get(event)?.delete(handler);
  }),
}));

const fetchSpy = vi.fn();
vi.stubGlobal("fetch", fetchSpy);

const { useGenerationPolling } = await import("./use-generation-polling");

// ── Helpers ───────────────────────────────────────────────────────

import type { Encounter } from "@/lib/types";

function makeVisit(overrides: Partial<Encounter> = {}): Encounter {
  return {
    id: "v1",
    user_id: "u1",
    title: "Test",
    audio_path: null,
    language: "sk",
    visit_date: "2025-01-01",
    patient_name: null,
    patient_id: null,
    visit_type: "consultation",
    status: "started",
    encounter_note: null,
    metadata: {},
    created_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function defaultOptions(overrides: Record<string, unknown> = {}) {
  return {
    visitId: "v1",
    visit: null as Encounter | null,
    setVisit: vi.fn(),
    isStreaming: false,
    updateTitleRef: { current: vi.fn() },
    setGeneratedNoteHtml: vi.fn(),
    setCachedTemplate: vi.fn(),
    onPollTimeout: vi.fn(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe("useGenerationPolling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    eventHandlers.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not poll when visit is null", async () => {
    renderHook(() => useGenerationPolling(defaultOptions()));

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not poll when visit.status is not processing", async () => {
    const opts = defaultOptions({
      visit: makeVisit({ status: "started" }),
    });
    renderHook(() => useGenerationPolling(opts));

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not poll when isStreaming is true", async () => {
    const opts = defaultOptions({
      visit: makeVisit({ status: "processing" }),
      isStreaming: true,
    });
    renderHook(() => useGenerationPolling(opts));

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("polls when status is processing and not streaming", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeVisit({ status: "processing" })),
    });

    const opts = defaultOptions({
      visit: makeVisit({ status: "processing" }),
    });
    renderHook(() => useGenerationPolling(opts));

    // Advance past one poll interval (3s)
    await vi.advanceTimersByTimeAsync(3_500);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("stops polling and updates state when generation completes", async () => {
    const completedVisit = makeVisit({
      status: "to_review",
      encounter_note: "<p>Note</p>",
      title: "Generated Title",
      metadata: { template_id: "t1" },
    });
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(completedVisit),
    });

    const setVisit = vi.fn();
    const setGeneratedNoteHtml = vi.fn();
    const setCachedTemplate = vi.fn();
    const updateTitleRef = { current: vi.fn() };

    const opts = defaultOptions({
      visit: makeVisit({ status: "processing" }),
      setVisit,
      setGeneratedNoteHtml,
      setCachedTemplate,
      updateTitleRef,
    });
    renderHook(() => useGenerationPolling(opts));

    await vi.advanceTimersByTimeAsync(3_500);

    expect(setVisit).toHaveBeenCalledWith(completedVisit);
    expect(setGeneratedNoteHtml).toHaveBeenCalledWith("<p>Note</p>");
    expect(setCachedTemplate).toHaveBeenCalledWith("t1", {
      generatedNote: "<p>Note</p>",
    });
    expect(updateTitleRef.current).toHaveBeenCalledWith("Generated Title");

    // Should not poll again after finding completed generation
    fetchSpy.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls onPollTimeout and resets status after 3 minute timeout", async () => {
    // Always return processing
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeVisit({ status: "processing" })),
    });

    const setVisit = vi.fn();
    const onPollTimeout = vi.fn();

    const opts = defaultOptions({
      visit: makeVisit({ status: "processing" }),
      setVisit,
      onPollTimeout,
    });
    renderHook(() => useGenerationPolling(opts));

    // Advance past the 3-minute timeout
    await vi.advanceTimersByTimeAsync(185_000);

    expect(onPollTimeout).toHaveBeenCalled();
    expect(mockPatchEncounterStatus).toHaveBeenCalledWith("v1", "started");
    // setVisit should be called with the status reset
    expect(setVisit).toHaveBeenCalled();
  });

  it("re-fetches encounter on generation-done event", async () => {
    const completedVisit = makeVisit({
      status: "to_review",
      encounter_note: "<p>Done</p>",
      title: "Done Title",
    });
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(completedVisit),
    });

    const setVisit = vi.fn();
    const setGeneratedNoteHtml = vi.fn();
    const updateTitleRef = { current: vi.fn() };

    const opts = defaultOptions({
      visit: makeVisit({ status: "started" }), // not processing
      setVisit,
      setGeneratedNoteHtml,
      updateTitleRef,
    });
    renderHook(() => useGenerationPolling(opts));

    // Emit the event
    const { emit } = await import("@/lib/events");
    vi.mocked(emit).getMockImplementation()!("generation-done", {
      visitId: "v1",
    });

    // Let async handler complete
    await vi.advanceTimersByTimeAsync(100);

    expect(fetchSpy).toHaveBeenCalledWith("/api/encounters/v1");
    expect(setVisit).toHaveBeenCalledWith(completedVisit);
    expect(setGeneratedNoteHtml).toHaveBeenCalledWith("<p>Done</p>");
    expect(updateTitleRef.current).toHaveBeenCalledWith("Done Title");
  });
});
