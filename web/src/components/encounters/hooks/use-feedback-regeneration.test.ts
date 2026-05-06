// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useFeedbackRegeneration } from "./use-feedback-regeneration";
import type { Template } from "@/lib/templates";

// ── Mocks ─────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockReplaceSections = vi.fn();

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useFeedbackRegeneration", () => {
  it("submits feedback and triggers section regeneration", async () => {
    // Setup: Mock successful feedback submission
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "fb-1" }),
    });

    // Setup: Mock successful section regeneration
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          sectionId: "history",
          content: "Updated history with patient age: 45 years old...",
        }),
    });

    const sectionContents = {
      history: "Patient presented with symptoms...",
    };

    const mockTemplate: Template = {
      id: "template-1",
      name: { en: "Test Template" },
      description: { en: "Test" },
      sections: [
        {
          id: "history",
          labels: { en: "History" },
        },
      ],
    };

    const { result } = renderHook(() =>
      useFeedbackRegeneration({
        visitId: "visit-123",
        sectionContentsRef: { current: sectionContents },
        replaceSections: mockReplaceSections,
        template: mockTemplate,
        sectionLabels: { history: "History" },
      }),
    );

    // Act: Submit feedback for a section
    await act(async () => {
      await result.current.handleSectionSubmitFeedback(
        "history",
        "Always include patient age in the first sentence",
        true, // remember for future
      );
    });

    // Assert: Feedback was submitted to API
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/encounters/visit-123/feedback",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"remember":true'),
      }),
    );

    // Assert: Section regeneration was triggered
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/adjust-section",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"sectionId":"history"'),
        }),
      );
    });

    // Assert: Section content was updated
    await waitFor(() => {
      expect(mockReplaceSections).toHaveBeenCalledWith({
        history: "Updated history with patient age: 45 years old...",
      });
    });
  });

  it("shows regenerating state for the section being regenerated", async () => {
    // Setup: Mock successful feedback submission
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

    // Mock delayed regeneration
    mockFetch.mockImplementationOnce(() => regenPromise);

    const mockTemplate = {
      id: "template-1",
      name: { en: "Test Template" },
      description: { en: "Test" },
      sections: [{ id: "history", labels: { en: "History" } }],
    };

    const { result } = renderHook(() =>
      useFeedbackRegeneration({
        visitId: "visit-123",
        sectionContentsRef: { current: { history: "old content" } },
        replaceSections: vi.fn(),
        template: mockTemplate as unknown as Parameters<
          typeof useFeedbackRegeneration
        >[0]["template"],
      }),
    );

    // Initially, no section is regenerating
    expect(result.current.regeneratingSectionId).toBeNull();

    // Act: Submit feedback (don't await yet)
    const submitPromise = result.current.handleSectionSubmitFeedback(
      "history",
      "test feedback",
      false,
    );

    // During regeneration, section ID should be set
    await waitFor(() => {
      expect(result.current.regeneratingSectionId).toBe("history");
    });

    // Complete the regeneration
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

    // After regeneration completes, should be null again
    expect(result.current.regeneratingSectionId).toBeNull();
  });

  it("regenerates specific subsections when feedback is on parent section", async () => {
    // Setup: Parent section has no content, but has subsections
    const sectionContents = {
      "physical-exam": "", // parent section (no content)
      "physical-exam.blood-pressure": "BP: 120/80 mmHg",
      "physical-exam.pulse": "HR: 72 bpm",
      "physical-exam.general": "Patient appears well",
    };

    // Mock template with parent section and subsections
    const mockTemplate = {
      id: "template-1",
      name: { en: "Test Template" },
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

    // Mock successful feedback submission
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "fb-1" }),
    });

    // Mock successful subsection regeneration
    // API should return updates for the subsections mentioned in feedback
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

    const { result } = renderHook(() =>
      useFeedbackRegeneration({
        visitId: "visit-123",
        sectionContentsRef: { current: sectionContents },
        replaceSections: mockReplaceSections,
        template: mockTemplate as unknown as Parameters<
          typeof useFeedbackRegeneration
        >[0]["template"],
        sectionLabels: {
          "physical-exam": "Physical Examination",
          "physical-exam.blood-pressure": "Blood Pressure",
          "physical-exam.pulse": "Pulse",
          "physical-exam.general": "General",
        },
      }),
    );

    // Act: Submit feedback on parent section mentioning "blood pressure" and "pulse"
    await act(async () => {
      await result.current.handleSectionSubmitFeedback(
        "physical-exam",
        "Add normal ranges for blood pressure and pulse",
        false,
      );
    });

    // Assert: Feedback was submitted
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/encounters/visit-123/feedback",
      expect.objectContaining({
        method: "POST",
      }),
    );

    // Assert: adjust-section was called with parent section and subsections
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/adjust-section",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"sectionId":"physical-exam"'),
        }),
      );
    });

    // Assert: Only mentioned subsections were updated
    await waitFor(() => {
      expect(mockReplaceSections).toHaveBeenCalledWith({
        "physical-exam.blood-pressure": "BP: 120/80 mmHg (normal)",
        "physical-exam.pulse": "HR: 72 bpm (regular rhythm)",
      });
    });
  });

  it("matches Slovak medical terms flexibly (partial words, case-insensitive)", async () => {
    // Setup: Parent section with Slovak subsection labels
    const sectionContents = {
      vitals: "", // parent section (no content)
      "vitals.blood-pressure": "",
      "vitals.pulse": "",
      "vitals.temperature": "",
    };

    const mockTemplate = {
      id: "template-1",
      name: { sk: "Test Template" },
      description: { sk: "Test" },
      sections: [
        {
          id: "vitals",
          labels: { sk: "Vitálne funkcie" },
          subsections: [
            { id: "vitals.blood-pressure", labels: { sk: "Krvný tlak" } },
            { id: "vitals.pulse", labels: { sk: "Pulz" } },
            { id: "vitals.temperature", labels: { sk: "Teplota" } },
          ],
        },
      ],
    };

    // Mock successful feedback submission
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "fb-1" }),
    });

    // Mock API response - Claude matches "tlak" to "Krvný tlak" and "pulz" to "Pulz"
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          updates: {
            "vitals.blood-pressure": "150/80 mmHg",
            "vitals.pulse": "90 bpm",
          },
        }),
    });

    const { result } = renderHook(() =>
      useFeedbackRegeneration({
        visitId: "visit-123",
        sectionContentsRef: { current: sectionContents },
        replaceSections: mockReplaceSections,
        template: mockTemplate as unknown as Parameters<
          typeof useFeedbackRegeneration
        >[0]["template"],
        sectionLabels: {
          vitals: "Vitálne funkcie",
          "vitals.blood-pressure": "Krvný tlak",
          "vitals.pulse": "Pulz",
          "vitals.temperature": "Teplota",
        },
      }),
    );

    // Act: Submit feedback using partial Slovak terms (lowercase "tlak" instead of "Krvný tlak")
    await act(async () => {
      await result.current.handleSectionSubmitFeedback(
        "vitals",
        "tlak 150/80, pulz 90",
        false,
      );
    });

    // Assert: adjust-section was called with subsections and labels
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/adjust-section",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"subsectionLabels"'),
        }),
      );
    });

    // Assert: Both subsections were updated despite partial/lowercase matching
    await waitFor(() => {
      expect(mockReplaceSections).toHaveBeenCalledWith({
        "vitals.blood-pressure": "150/80 mmHg",
        "vitals.pulse": "90 bpm",
      });
    });
  });
});
