// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSidebarEncounters, _resetCache } from "./use-sidebar-encounters";
import type { Encounter, EncounterListResponse } from "@/lib/types";
import { emit } from "@/lib/events";

// No longer uses usePathname — sidebar fetches on mount only

const makeVisit = (overrides: Partial<Encounter> = {}): Encounter => ({
  id: crypto.randomUUID(),
  user_id: "user-1",
  title: "Test visit",
  audio_path: null,
  language: "sk",
  visit_date: "2025-01-15",
  patient_name: null,
  patient_id: null,
  visit_type: "consultation",
  status: "started",
  encounter_note: null,
  metadata: {},
  created_at: "2025-01-15T10:00:00Z",
  ...overrides,
});

function mockFetchResponse(data: EncounterListResponse) {
  (global.fetch as Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => data,
  });
}

function mockFetchOk() {
  (global.fetch as Mock).mockResolvedValueOnce({ ok: true });
}

function mockFetchError() {
  (global.fetch as Mock).mockResolvedValueOnce({ ok: false });
}

describe("useSidebarEncounters", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn();
    _resetCache();
  });

  it("fetches visits on mount", async () => {
    const visits = [
      makeVisit({ title: "Visit 1" }),
      makeVisit({ title: "Visit 2" }),
    ];
    mockFetchResponse({ encounters: visits, total: 2, page: 1, limit: 20 });

    const { result } = renderHook(() => useSidebarEncounters());

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.visits).toHaveLength(2);
    expect(result.current.visits[0].title).toBe("Visit 1");
    expect(result.current.hasMore).toBe(false);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/encounters?"),
    );
  });

  it("loads more visits on loadMore", async () => {
    const page1 = [makeVisit({ title: "Visit 1" })];
    const page2 = [makeVisit({ title: "Visit 2" })];
    mockFetchResponse({ encounters: page1, total: 2, page: 1, limit: 20 });

    const { result } = renderHook(() => useSidebarEncounters());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasMore).toBe(true);

    mockFetchResponse({ encounters: page2, total: 2, page: 2, limit: 20 });
    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.visits).toHaveLength(2);
    });

    expect(result.current.visits[1].title).toBe("Visit 2");
  });

  it("optimistically deletes a visit", async () => {
    const visit = makeVisit({ title: "To delete" });
    mockFetchResponse({ encounters: [visit], total: 1, page: 1, limit: 20 });

    const { result } = renderHook(() => useSidebarEncounters());

    await waitFor(() => {
      expect(result.current.visits).toHaveLength(1);
    });

    mockFetchOk();
    act(() => {
      result.current.deleteVisit(visit.id);
    });

    // Optimistic: immediately removed
    expect(result.current.visits).toHaveLength(0);
  });

  it("reverts delete on API failure", async () => {
    const visit = makeVisit({ title: "Keep me" });
    mockFetchResponse({ encounters: [visit], total: 1, page: 1, limit: 20 });

    const { result } = renderHook(() => useSidebarEncounters());

    await waitFor(() => {
      expect(result.current.visits).toHaveLength(1);
    });

    // API fails → triggers refetch
    mockFetchError();
    mockFetchResponse({ encounters: [visit], total: 1, page: 1, limit: 20 });

    act(() => {
      result.current.deleteVisit(visit.id);
    });

    // Optimistic remove
    expect(result.current.visits).toHaveLength(0);

    // After refetch, visit is back
    await waitFor(() => {
      expect(result.current.visits).toHaveLength(1);
    });
  });

  it("optimistically marks a visit complete", async () => {
    const visit = makeVisit({ status: "started" });
    mockFetchResponse({ encounters: [visit], total: 1, page: 1, limit: 20 });

    const { result } = renderHook(() => useSidebarEncounters());

    await waitFor(() => {
      expect(result.current.visits[0].status).toBe("started");
    });

    mockFetchOk();
    act(() => {
      result.current.markComplete(visit.id);
    });

    expect(result.current.visits[0].status).toBe("completed");
  });

  it("reverts markComplete on API failure", async () => {
    const visit = makeVisit({ status: "started" });
    mockFetchResponse({ encounters: [visit], total: 1, page: 1, limit: 20 });

    const { result } = renderHook(() => useSidebarEncounters());

    await waitFor(() => {
      expect(result.current.visits[0].status).toBe("started");
    });

    mockFetchError();
    mockFetchResponse({ encounters: [visit], total: 1, page: 1, limit: 20 });

    act(() => {
      result.current.markComplete(visit.id);
    });

    // Optimistic
    expect(result.current.visits[0].status).toBe("completed");

    // After refetch, status reverts
    await waitFor(() => {
      expect(result.current.visits[0].status).toBe("started");
    });
  });

  it("adds new encounter via sidebar-refresh event", async () => {
    const existing = makeVisit({ title: "Existing" });
    mockFetchResponse({
      encounters: [existing],
      total: 1,
      page: 1,
      limit: 20,
    });

    const { result } = renderHook(() => useSidebarEncounters());

    await waitFor(() => {
      expect(result.current.visits).toHaveLength(1);
    });

    const newEncounter = makeVisit({ title: "New encounter" });
    act(() => {
      emit("sidebar-refresh", { encounter: newEncounter });
    });

    expect(result.current.visits).toHaveLength(2);
    expect(result.current.visits[0].title).toBe("New encounter");
  });

  it("does not duplicate encounter on sidebar-refresh", async () => {
    const existing = makeVisit({ title: "Existing" });
    mockFetchResponse({
      encounters: [existing],
      total: 1,
      page: 1,
      limit: 20,
    });

    const { result } = renderHook(() => useSidebarEncounters());

    await waitFor(() => {
      expect(result.current.visits).toHaveLength(1);
    });

    // Dispatch sidebar-refresh with same encounter
    act(() => {
      emit("sidebar-refresh", { encounter: existing });
    });

    // Should not duplicate
    expect(result.current.visits).toHaveLength(1);
  });

  it("handles fetch failure gracefully", async () => {
    (global.fetch as Mock).mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useSidebarEncounters());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // No crash, empty visits
    expect(result.current.visits).toHaveLength(0);
  });
});
