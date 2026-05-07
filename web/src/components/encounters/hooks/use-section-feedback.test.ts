// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSectionFeedback } from "./use-section-feedback";
import type { Template } from "@/lib/templates";

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockReplaceSections = vi.fn();

// ── Helpers ───────────────────────────────────────────────────────

function defaultParams() {
  return {
    visitId: "v1" as string | undefined,
    sectionContentsRef: { current: {} as Record<string, string> },
    replaceSections: mockReplaceSections,
    template: null as Template | null,
    sectionLabels: {} as Record<string, string>,
  };
}

function emptyFeedbackLoad() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ feedback: [] }),
  });
}

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useSectionFeedback", () => {
  // ── Rating CRUD ─────────────────────────────────────────────────

  describe("ratings", () => {
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

      const { result } = renderHook(() => useSectionFeedback(defaultParams()));

      await vi.waitFor(() => {
        expect(result.current.getRating("oa")).toBe("down");
      });

      expect(result.current.getRating(null)).toBe("up");
      expect(result.current.getRating("la")).toBeNull();
    });

    it("submits thumbs-up and updates local state", async () => {
      emptyFeedbackLoad();

      const { result } = renderHook(() => useSectionFeedback(defaultParams()));
      await vi.waitFor(() => expect(result.current.isLoaded).toBe(true));

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
      emptyFeedbackLoad();

      const { result } = renderHook(() => useSectionFeedback(defaultParams()));
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

  // ── Section regeneration ────────────────────────────────────────

  describe("handleSectionSubmitFeedback", () => {
    it("submits feedback and triggers section regeneration", async () => {
      emptyFeedbackLoad();

      // Feedback submit
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "fb-1" }),
      });

      // Section regeneration
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            sectionId: "history",
            content: "Updated history with patient age: 45 years old...",
          }),
      });

      const params = defaultParams();
      params.sectionContentsRef = {
        current: { history: "Patient presented with symptoms..." },
      };
      params.template = {
        id: "template-1",
        name: { en: "Test Template" },
        description: { en: "Test" },
        sections: [{ id: "history", labels: { en: "History" } }],
      };
      params.sectionLabels = { history: "History" };

      const { result } = renderHook(() => useSectionFeedback(params));
      await vi.waitFor(() => expect(result.current.isLoaded).toBe(true));

      await act(async () => {
        await result.current.handleSectionSubmitFeedback(
          "history",
          "Always include patient age in the first sentence",
          true,
        );
      });

      // Feedback submitted
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/encounters/v1/feedback",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"remember":true'),
        }),
      );

      // Section regeneration triggered
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/adjust-section",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining('"sectionId":"history"'),
          }),
        );
      });

      // Content updated
      await waitFor(() => {
        expect(mockReplaceSections).toHaveBeenCalledWith({
          history: "Updated history with patient age: 45 years old...",
        });
      });
    });

    it("shows regenerating state during regeneration", async () => {
      emptyFeedbackLoad();

      // Feedback submit
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "fb-1" }),
      });

      let resolveRegen: (value: {
        ok: boolean;
        json: () => Promise<unknown>;
      }) => void;
      const regenPromise = new Promise((resolve) => {
        resolveRegen = resolve;
      });
      mockFetch.mockImplementationOnce(() => regenPromise);

      const params = defaultParams();
      params.sectionContentsRef = { current: { history: "old content" } };
      params.template = {
        id: "template-1",
        name: { en: "Test Template" },
        description: { en: "Test" },
        sections: [{ id: "history", labels: { en: "History" } }],
      };

      const { result } = renderHook(() => useSectionFeedback(params));
      await vi.waitFor(() => expect(result.current.isLoaded).toBe(true));

      expect(result.current.regeneratingSectionId).toBeNull();

      const submitPromise = result.current.handleSectionSubmitFeedback(
        "history",
        "test feedback",
        false,
      );

      await waitFor(() => {
        expect(result.current.regeneratingSectionId).toBe("history");
      });

      await act(async () => {
        resolveRegen!({
          ok: true,
          json: () =>
            Promise.resolve({
              sectionId: "history",
              content: "Updated content",
            }),
        });
        await submitPromise;
      });

      expect(result.current.regeneratingSectionId).toBeNull();
    });

    it("regenerates specific subsections for parent section", async () => {
      emptyFeedbackLoad();

      // Feedback submit
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "fb-1" }),
      });

      // Subsection regeneration
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            updates: {
              "physical-exam.blood-pressure": "BP: 120/80 mmHg (normal)",
              "physical-exam.pulse": "HR: 72 bpm (regular rhythm)",
            },
          }),
      });

      const params = defaultParams();
      params.sectionContentsRef = {
        current: {
          "physical-exam": "",
          "physical-exam.blood-pressure": "BP: 120/80 mmHg",
          "physical-exam.pulse": "HR: 72 bpm",
          "physical-exam.general": "Patient appears well",
        },
      };
      params.template = {
        id: "template-1",
        name: { en: "Test" },
        description: { en: "Test" },
        sections: [
          {
            id: "physical-exam",
            labels: { en: "Physical Examination" },
            subsections: [
              {
                id: "physical-exam.blood-pressure",
                labels: { en: "Blood Pressure" },
              },
              { id: "physical-exam.pulse", labels: { en: "Pulse" } },
              { id: "physical-exam.general", labels: { en: "General" } },
            ],
          },
        ],
      };
      params.sectionLabels = {
        "physical-exam": "Physical Examination",
        "physical-exam.blood-pressure": "Blood Pressure",
        "physical-exam.pulse": "Pulse",
        "physical-exam.general": "General",
      };

      const { result } = renderHook(() => useSectionFeedback(params));
      await vi.waitFor(() => expect(result.current.isLoaded).toBe(true));

      await act(async () => {
        await result.current.handleSectionSubmitFeedback(
          "physical-exam",
          "Add normal ranges for blood pressure and pulse",
          false,
        );
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/adjust-section",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining('"sectionId":"physical-exam"'),
          }),
        );
      });

      await waitFor(() => {
        expect(mockReplaceSections).toHaveBeenCalledWith({
          "physical-exam.blood-pressure": "BP: 120/80 mmHg (normal)",
          "physical-exam.pulse": "HR: 72 bpm (regular rhythm)",
        });
      });
    });

    it("updates local rating to down after submit", async () => {
      emptyFeedbackLoad();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "fb-1" }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sectionId: "s1", content: "Updated." }),
      });

      const params = defaultParams();
      params.sectionContentsRef = { current: { s1: "Original" } };

      const { result } = renderHook(() => useSectionFeedback(params));
      await vi.waitFor(() => expect(result.current.isLoaded).toBe(true));

      await act(async () => {
        await result.current.handleSectionSubmitFeedback(
          "s1",
          "Fix this",
          false,
        );
      });

      expect(result.current.getRating("s1")).toBe("down");
    });
  });
});
