// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "@/test/route-helpers";

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockSupabase = createMockSupabase();

beforeEach(() => {
  vi.resetAllMocks();
  for (const key of Object.keys(mockSupabase)) {
    const val = mockSupabase[key as keyof typeof mockSupabase];
    if (typeof val === "function" && "mockReturnThis" in val) {
      val.mockReturnThis();
    }
  }
  mockSupabase.single.mockResolvedValue({ data: null, error: null });
  mockSupabase.rpc.mockResolvedValue({ error: null });
});

// ── Tests ─────────────────────────────────────────────────────────

describe("formatFeedbackEntry", () => {
  it("formats section-specific entry with category + bad output + detail", async () => {
    const { formatFeedbackEntry } = await import("./feedback");

    const result = formatFeedbackEntry({
      id: "fb-1",
      sectionId: "oa",
      categories: ["hallucination"],
      detail: "Patient never said they had a fever",
      sectionContent: "Patient presented with fever and headache",
    });

    expect(result).toBe(
      '- [hallucination] "Patient presented with fever and headache" → Doctor: "Patient never said they had a fever"',
    );
  });

  it("formats entry with multiple categories joined", async () => {
    const { formatFeedbackEntry } = await import("./feedback");

    const result = formatFeedbackEntry({
      id: "fb-2",
      sectionId: "la",
      categories: ["hallucination", "missing-info"],
      detail: "Wrong dose and missed BP",
      sectionContent: "Ibuprofen 200mg",
    });

    expect(result).toBe(
      '- [hallucination, missing-info] "Ibuprofen 200mg" → Doctor: "Wrong dose and missed BP"',
    );
  });

  it("formats global entry with GENERAL label and no section content", async () => {
    const { formatFeedbackEntry } = await import("./feedback");

    const result = formatFeedbackEntry({
      id: "fb-3",
      sectionId: null,
      categories: ["style"],
      detail: "LA had wrong medication dose, TO was redundant",
      sectionContent: null,
    });

    expect(result).toBe(
      '- [GENERAL][style] → Doctor: "LA had wrong medication dose, TO was redundant"',
    );
  });

  it("handles empty detail gracefully", async () => {
    const { formatFeedbackEntry } = await import("./feedback");

    const result = formatFeedbackEntry({
      id: "fb-4",
      sectionId: "oa",
      categories: ["redundant"],
      detail: "",
      sectionContent: "Too much info here",
    });

    expect(result).toBe('- [redundant] "Too much info here"');
  });

  it("handles empty categories (inline feedback) for section", async () => {
    const { formatFeedbackEntry } = await import("./feedback");

    const result = formatFeedbackEntry({
      id: "fb-5",
      sectionId: "oa",
      categories: [],
      detail: "Remove the xyz medication from the list",
      sectionContent: "Medications: xyz, abc",
    });

    expect(result).toBe(
      '- "Medications: xyz, abc" → Doctor: "Remove the xyz medication from the list"',
    );
  });

  it("handles empty categories (inline feedback) for global", async () => {
    const { formatFeedbackEntry } = await import("./feedback");

    const result = formatFeedbackEntry({
      id: "fb-6",
      sectionId: null,
      categories: [],
      detail: "Make it more concise overall",
      sectionContent: null,
    });

    expect(result).toBe('- [GENERAL] → Doctor: "Make it more concise overall"');
  });
});

describe("buildFeedbackMap", () => {
  it("returns empty map when no feedback entries", async () => {
    const { buildFeedbackMap } = await import("./feedback");
    const result = buildFeedbackMap([], ["oa", "la"]);
    expect(result.size).toBe(0);
  });

  it("assigns section-specific entries to their section", async () => {
    const { buildFeedbackMap } = await import("./feedback");
    const result = buildFeedbackMap(
      [
        {
          id: "fb-1",
          sectionId: "oa",
          categories: ["hallucination"],
          detail: "Wrong",
          sectionContent: "Bad output",
        },
      ],
      ["oa", "la"],
    );

    expect(result.has("oa")).toBe(true);
    expect(result.has("la")).toBe(false);
    expect(result.get("oa")).toContain("# Prior corrections");
    expect(result.get("oa")).toContain("[hallucination]");
  });

  it("broadcasts global entries to all sections", async () => {
    const { buildFeedbackMap } = await import("./feedback");
    const result = buildFeedbackMap(
      [
        {
          id: "fb-g",
          sectionId: null,
          categories: ["style"],
          detail: "Too verbose everywhere",
          sectionContent: null,
        },
      ],
      ["oa", "la", "to"],
    );

    // Global entry should appear in all 3 sections
    expect(result.size).toBe(3);
    for (const sectionId of ["oa", "la", "to"]) {
      expect(result.get(sectionId)).toContain("[GENERAL]");
      expect(result.get(sectionId)).toContain("Too verbose everywhere");
    }
  });

  it("section-specific takes priority, global fills remaining (cap 3)", async () => {
    const { buildFeedbackMap } = await import("./feedback");
    const result = buildFeedbackMap(
      [
        // 3 section-specific for OA
        {
          id: "fb-1",
          sectionId: "oa",
          categories: ["hallucination"],
          detail: "First",
          sectionContent: "Bad 1",
        },
        {
          id: "fb-2",
          sectionId: "oa",
          categories: ["missing-info"],
          detail: "Second",
          sectionContent: "Bad 2",
        },
        {
          id: "fb-3",
          sectionId: "oa",
          categories: ["style"],
          detail: "Third",
          sectionContent: "Bad 3",
        },
        // 1 global — should NOT appear in OA (already at cap)
        {
          id: "fb-g",
          sectionId: null,
          categories: ["redundant"],
          detail: "Global note",
          sectionContent: null,
        },
      ],
      ["oa", "la"],
    );

    // OA: 3 section-specific, no global
    const oaBlock = result.get("oa")!;
    expect(oaBlock).toContain("First");
    expect(oaBlock).toContain("Second");
    expect(oaBlock).toContain("Third");
    expect(oaBlock).not.toContain("[GENERAL]");

    // LA: 0 section-specific, 1 global (fills remaining)
    const laBlock = result.get("la")!;
    expect(laBlock).toContain("[GENERAL]");
    expect(laBlock).toContain("Global note");
  });

  it("caps total entries at 3 mixing specific + global", async () => {
    const { buildFeedbackMap } = await import("./feedback");
    const result = buildFeedbackMap(
      [
        {
          id: "fb-1",
          sectionId: "oa",
          categories: ["hallucination"],
          detail: "Specific 1",
          sectionContent: "Bad",
        },
        {
          id: "fb-2",
          sectionId: "oa",
          categories: ["missing-info"],
          detail: "Specific 2",
          sectionContent: "Bad",
        },
        // 2 globals — only 1 should fit (cap is 3)
        {
          id: "fb-g1",
          sectionId: null,
          categories: ["style"],
          detail: "Global 1",
          sectionContent: null,
        },
        {
          id: "fb-g2",
          sectionId: null,
          categories: ["redundant"],
          detail: "Global 2",
          sectionContent: null,
        },
      ],
      ["oa"],
    );

    const oaBlock = result.get("oa")!;
    expect(oaBlock).toContain("Specific 1");
    expect(oaBlock).toContain("Specific 2");
    expect(oaBlock).toContain("Global 1");
    expect(oaBlock).not.toContain("Global 2");
  });

  it("skips sections not in sectionIds list", async () => {
    const { buildFeedbackMap } = await import("./feedback");
    const result = buildFeedbackMap(
      [
        {
          id: "fb-1",
          sectionId: "oa",
          categories: ["hallucination"],
          detail: "For OA",
          sectionContent: "Bad",
        },
      ],
      ["la"], // OA not in list
    );

    expect(result.size).toBe(0);
  });
});

describe("getActiveFeedback", () => {
  it("queries active negative feedback for user + template", async () => {
    const rows = [
      {
        id: "fb-1",
        section_id: "oa",
        categories: ["hallucination"],
        detail: "Wrong fever",
        section_content: "Patient had fever",
      },
      {
        id: "fb-2",
        section_id: null,
        categories: ["style"],
        detail: "Too verbose",
        section_content: null,
      },
    ];

    // Two .is() calls: first chains, second (terminal) resolves
    mockSupabase.is
      .mockReturnValueOnce(mockSupabase)
      .mockResolvedValueOnce({ data: rows, error: null });

    const { getActiveFeedback } = await import("./feedback");
    const result = await getActiveFeedback(
      mockSupabase as never,
      "user-123",
      "tmpl-abc",
    );

    // Verify correct table + filters
    expect(mockSupabase.from).toHaveBeenCalledWith("section_feedback");
    expect(mockSupabase.eq).toHaveBeenCalledWith("rating", "down");
    expect(mockSupabase.eq).toHaveBeenCalledWith("user_id", "user-123");
    expect(mockSupabase.eq).toHaveBeenCalledWith("template_id", "tmpl-abc");

    // Should map snake_case → camelCase
    expect(result).toEqual([
      {
        id: "fb-1",
        sectionId: "oa",
        categories: ["hallucination"],
        detail: "Wrong fever",
        sectionContent: "Patient had fever",
      },
      {
        id: "fb-2",
        sectionId: null,
        categories: ["style"],
        detail: "Too verbose",
        sectionContent: null,
      },
    ]);
  });

  it("returns empty array on query error", async () => {
    mockSupabase.is.mockReturnValueOnce(mockSupabase).mockResolvedValueOnce({
      data: null,
      error: { message: "DB down" },
    });

    const { getActiveFeedback } = await import("./feedback");
    const result = await getActiveFeedback(
      mockSupabase as never,
      "user-123",
      "tmpl-abc",
    );

    expect(result).toEqual([]);
  });
});

describe("incrementCleanStreaks", () => {
  it("calls rpc to increment streaks for rendered sections", async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ error: null });

    const { incrementCleanStreaks } = await import("./feedback");
    await incrementCleanStreaks(mockSupabase as never, "user-123", "tmpl-abc", [
      "oa",
      "la",
    ]);

    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      "increment_feedback_streaks",
      {
        p_user_id: "user-123",
        p_template_id: "tmpl-abc",
        p_section_ids: ["oa", "la"],
      },
    );
  });

  it("logs error but does not throw on rpc failure", async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      error: { message: "RPC failed" },
    });

    const { incrementCleanStreaks } = await import("./feedback");
    // Should not throw
    await incrementCleanStreaks(mockSupabase as never, "user-123", "tmpl-abc", [
      "oa",
    ]);

    // Verify logger.error was called
    const { logger } = await import("@/lib/logger");
    expect(logger.error).toHaveBeenCalled();
  });
});
