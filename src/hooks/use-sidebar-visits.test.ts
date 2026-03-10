import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSidebarVisits } from "./use-sidebar-visits";
import type { Visit, VisitListResponse } from "@/lib/types";

// Mock next/navigation
const mockPathname = vi.fn(() => "/");
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

const makeVisit = (overrides: Partial<Visit> = {}): Visit => ({
  id: crypto.randomUUID(),
  user_id: "user-1",
  title: "Test visit",
  audio_path: null,
  raw_text: null,
  language: "sk",
  visit_date: "2025-01-15",
  patient_name: null,
  patient_id: null,
  visit_type: "consultation",
  status: "draft",
  soap_note: null,
  patient_letter: null,
  metadata: {},
  created_at: "2025-01-15T10:00:00Z",
  ...overrides,
});

function mockFetchResponse(data: VisitListResponse) {
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

describe("useSidebarVisits", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn();
    mockPathname.mockReturnValue("/");
  });

  it("fetches visits on mount", async () => {
    const visits = [makeVisit({ title: "Visit 1" }), makeVisit({ title: "Visit 2" })];
    mockFetchResponse({ visits, total: 2 });

    const { result } = renderHook(() => useSidebarVisits());

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.visits).toHaveLength(2);
    expect(result.current.visits[0].title).toBe("Visit 1");
    expect(result.current.hasMore).toBe(false);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/encounters?")
    );
  });

  it("loads more visits on loadMore", async () => {
    const page1 = [makeVisit({ title: "Visit 1" })];
    const page2 = [makeVisit({ title: "Visit 2" })];
    mockFetchResponse({ visits: page1, total: 2 });

    const { result } = renderHook(() => useSidebarVisits());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasMore).toBe(true);

    mockFetchResponse({ visits: page2, total: 2 });
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
    mockFetchResponse({ visits: [visit], total: 1 });

    const { result } = renderHook(() => useSidebarVisits());

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
    mockFetchResponse({ visits: [visit], total: 1 });

    const { result } = renderHook(() => useSidebarVisits());

    await waitFor(() => {
      expect(result.current.visits).toHaveLength(1);
    });

    // API fails → triggers refetch
    mockFetchError();
    mockFetchResponse({ visits: [visit], total: 1 });

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
    const visit = makeVisit({ status: "draft" });
    mockFetchResponse({ visits: [visit], total: 1 });

    const { result } = renderHook(() => useSidebarVisits());

    await waitFor(() => {
      expect(result.current.visits[0].status).toBe("draft");
    });

    mockFetchOk();
    act(() => {
      result.current.markComplete(visit.id);
    });

    expect(result.current.visits[0].status).toBe("completed");
  });

  it("reverts markComplete on API failure", async () => {
    const visit = makeVisit({ status: "draft" });
    mockFetchResponse({ visits: [visit], total: 1 });

    const { result } = renderHook(() => useSidebarVisits());

    await waitFor(() => {
      expect(result.current.visits[0].status).toBe("draft");
    });

    mockFetchError();
    mockFetchResponse({ visits: [visit], total: 1 });

    act(() => {
      result.current.markComplete(visit.id);
    });

    // Optimistic
    expect(result.current.visits[0].status).toBe("completed");

    // After refetch, status reverts
    await waitFor(() => {
      expect(result.current.visits[0].status).toBe("draft");
    });
  });

  it("handles fetch failure gracefully", async () => {
    (global.fetch as Mock).mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useSidebarVisits());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // No crash, empty visits
    expect(result.current.visits).toHaveLength(0);
  });
});
