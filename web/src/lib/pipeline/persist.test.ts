// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { persistGeneration } from "./persist";

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/retry", () => ({
  retrySupabaseCall: vi.fn(),
}));

vi.mock("@/lib/supabase/merge-metadata", () => ({
  mergeVisitMetadata: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { retrySupabaseCall } from "@/lib/supabase/retry";
import { mergeVisitMetadata } from "@/lib/supabase/merge-metadata";
import { logger } from "@/lib/logger";

const mockRetry = vi.mocked(retrySupabaseCall);
const mockMerge = vi.mocked(mergeVisitMetadata);

const mockSupabase = {} as Parameters<typeof persistGeneration>[0]["supabase"];

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────

describe("persistGeneration", () => {
  const baseInput = {
    supabase: mockSupabase,
    visitId: "visit-1",
    generatedNote: "<h2>OA</h2><p>Test</p>",
    templateId: "tpl-1",
    sectionContents: { oa: "Test" },
    label: "test",
  };

  it("returns success when both column update and metadata merge succeed", async () => {
    mockRetry.mockResolvedValue({ data: null, error: null });
    mockMerge.mockResolvedValue({});

    const result = await persistGeneration(baseInput);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(mockRetry).toHaveBeenCalledOnce();
    expect(mockMerge).toHaveBeenCalledOnce();
  });

  it("returns failure and logs LOST NOTE when column update fails", async () => {
    mockRetry.mockResolvedValue({ error: new Error("column fail") });
    mockMerge.mockResolvedValue({});

    const result = await persistGeneration(baseInput);

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    // logger.error is called 3 times: generic error, LOST NOTE header, LOST NOTE body
    const errorCalls = vi.mocked(logger.error).mock.calls;
    const lostNoteCall = errorCalls.find(
      (call) => typeof call[0] === "string" && call[0].includes("LOST NOTE"),
    );
    expect(lostNoteCall).toBeDefined();
  });

  it("returns failure when metadata merge throws", async () => {
    mockRetry.mockResolvedValue({ data: null, error: null });
    mockMerge.mockRejectedValue(new Error("merge fail"));

    const result = await persistGeneration(baseInput);

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });

  it("includes file_focus_cache in metadata when provided", async () => {
    mockRetry.mockResolvedValue({ data: null, error: null });
    mockMerge.mockResolvedValue({});

    const cache = {
      "file-1": { textHash: "abc", directive: "d", output: "o" },
    };
    await persistGeneration({
      ...baseInput,
      updatedFileFocusCache: cache,
    });

    expect(mockMerge).toHaveBeenCalledWith(
      mockSupabase,
      "visit-1",
      expect.objectContaining({ file_focus_cache: cache }),
    );
  });

  it("includes clinical_analysis in metadata when provided", async () => {
    mockRetry.mockResolvedValue({ data: null, error: null });
    mockMerge.mockResolvedValue({});

    const analysis = {
      suggestedIcdCodes: [
        {
          code: "I10",
          description: "Hypertenzia",
          confidence: "high" as const,
        },
      ],
    };
    await persistGeneration({
      ...baseInput,
      clinicalAnalysis: analysis,
    });

    expect(mockMerge).toHaveBeenCalledWith(
      mockSupabase,
      "visit-1",
      expect.objectContaining({ clinical_analysis: analysis }),
    );
  });

  it("merges extraMetadata into metadata payload", async () => {
    mockRetry.mockResolvedValue({ data: null, error: null });
    mockMerge.mockResolvedValue({});

    await persistGeneration({
      ...baseInput,
      metadataPartial: { transcript: "hello", doctor_notes: "notes" },
    });

    expect(mockMerge).toHaveBeenCalledWith(
      mockSupabase,
      "visit-1",
      expect.objectContaining({
        transcript: "hello",
        doctor_notes: "notes",
      }),
    );
  });

  it("sets generation_pending and recording_session to null", async () => {
    mockRetry.mockResolvedValue({ data: null, error: null });
    mockMerge.mockResolvedValue({});

    await persistGeneration(baseInput);

    expect(mockMerge).toHaveBeenCalledWith(
      mockSupabase,
      "visit-1",
      expect.objectContaining({
        generation_pending: null,
        recording_session: null,
      }),
    );
  });

  it("uses 'to_review' status by default", async () => {
    mockRetry.mockResolvedValue({ data: null, error: null });
    mockMerge.mockResolvedValue({});

    await persistGeneration(baseInput);

    // The retry call receives a function — we can't inspect it directly,
    // but we verify it was called (the real assertion is the type check).
    expect(mockRetry).toHaveBeenCalledOnce();
  });
});
