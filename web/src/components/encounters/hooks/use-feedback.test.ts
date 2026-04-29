// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFeedback } from "./use-feedback";

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn() },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useFeedback", () => {
  it("loads existing feedback on mount and exposes rating map", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          feedback: [
            {
              id: "fb-1",
              section_id: "oa",
              rating: "down",
              categories: ["hallucination"],
              detail: "wrong",
            },
            {
              id: "fb-2",
              section_id: null,
              rating: "up",
              categories: [],
              detail: "",
            },
          ],
        }),
    });

    const { result } = renderHook(() => useFeedback("v1"));

    // Wait for fetch to resolve
    await vi.waitFor(() => {
      expect(result.current.getRating("oa")).toBe("down");
    });

    expect(result.current.getRating(null)).toBe("up");
    expect(result.current.getRating("la")).toBeNull();
  });

  it("submits thumbs-up and updates local state", async () => {
    // Initial load — no feedback
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ feedback: [] }),
    });

    const { result } = renderHook(() => useFeedback("v1"));
    await vi.waitFor(() => expect(result.current.isLoaded).toBe(true));

    // Submit thumbs-up
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "fb-new" }),
    });

    await act(() => result.current.submitUp("oa"));

    expect(result.current.getRating("oa")).toBe("up");
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/encounters/v1/feedback",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"rating":"up"'),
      }),
    );
  });

  it("submits thumbs-down with categories and detail", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ feedback: [] }),
    });

    const { result } = renderHook(() => useFeedback("v1"));
    await vi.waitFor(() => expect(result.current.isLoaded).toBe(true));

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "fb-down" }),
    });

    await act(() =>
      result.current.submitDown("oa", {
        sectionKind: "history-narrative",
        categories: ["hallucination", "missing-info"],
        detail: "Never said fever",
      }),
    );

    expect(result.current.getRating("oa")).toBe("down");

    const lastCall = mockFetch.mock.calls[1];
    const body = JSON.parse(lastCall[1].body);
    expect(body).toEqual(
      expect.objectContaining({
        sectionId: "oa",
        sectionKind: "history-narrative",
        rating: "down",
        categories: ["hallucination", "missing-info"],
        detail: "Never said fever",
      }),
    );
  });
});
