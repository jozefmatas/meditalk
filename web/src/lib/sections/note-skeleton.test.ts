// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/env/server", () => ({
  serverEnv: { NODE_ENV: "test" },
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-key",
    NEXT_PUBLIC_APP_URL: "",
  },
}));

const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

vi.mock("../usage", () => ({
  logUsage: vi.fn(),
}));

import {
  extractSkeleton,
  formatSkeletonBlock,
  type NoteSkeleton,
} from "./note-skeleton";
import type { RawSource } from "./section-agent";

function mockSkeletonResponse(input: Record<string, unknown>) {
  return {
    content: [
      {
        type: "tool_use",
        id: "toolu_test",
        name: "submit_skeleton",
        input,
      },
    ],
    usage: { input_tokens: 120, output_tokens: 80 },
    stop_reason: "tool_use",
  };
}

const MIN_SOURCE: RawSource = {
  transcript: "Pacient prijatý pre akútny koronárny syndróm.",
};

const FULL_INPUT = {
  chiefComplaint:
    "62-year-old male with recurrent chest pain; two-vessel CAD after PCI of RIA, presenting for rekoronarografia of RCX.",
  clinicalSummary:
    "History of ICHS with 2-vessel involvement. Post-PCI + 2× DES to RIA 26.9.2025. Persistent dyspnoe and chest pressure despite intervention. ECHO showed hypokinesis in RCX territory, EF ~50%.",
  encounterType: "transfer",
  keyDates: [
    { label: "Prior PCI (RIA)", iso: "2025-09-26" },
    { label: "ECHO", iso: "2025-12-18" },
  ],
  primarySystems: ["cardiovascular"],
  providers: ["Dr. Baldovský", "Dr. Gazdič", "CINRE"],
  criticalFindings: [
    "2-vessel CAD (RIA + RCX)",
    "LVEF ~50% with RCX hypokinesis",
    "Post-PCI + 2× DES RIA",
  ],
  confidence: "high",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractSkeleton — happy path", () => {
  it("returns a validated skeleton when the model responds cleanly", async () => {
    mockCreate.mockResolvedValue(mockSkeletonResponse(FULL_INPUT));

    const skeleton = await extractSkeleton(MIN_SOURCE, "sk");

    expect(skeleton).not.toBeNull();
    expect(skeleton?.encounterType).toBe("transfer");
    expect(skeleton?.providers).toEqual([
      "Dr. Baldovský",
      "Dr. Gazdič",
      "CINRE",
    ]);
    expect(skeleton?.keyDates).toEqual([
      { label: "Prior PCI (RIA)", iso: "2025-09-26" },
      { label: "ECHO", iso: "2025-12-18" },
    ]);
    expect(skeleton?.criticalFindings).toHaveLength(3);
    expect(skeleton?.confidence).toBe("high");
  });

  it("forces the tool call via tool_choice", async () => {
    mockCreate.mockResolvedValue(mockSkeletonResponse(FULL_INPUT));

    await extractSkeleton(MIN_SOURCE, "sk");

    const call = mockCreate.mock.calls[0][0];
    expect(call.tool_choice).toEqual({
      type: "tool",
      name: "submit_skeleton",
    });
    expect(call.tools).toBeDefined();
    expect(call.tools[0].name).toBe("submit_skeleton");
  });
});

describe("extractSkeleton — discard rules", () => {
  it("returns null on confidence=low (skeleton is unreliable)", async () => {
    mockCreate.mockResolvedValue(
      mockSkeletonResponse({ ...FULL_INPUT, confidence: "low" }),
    );
    const skeleton = await extractSkeleton(MIN_SOURCE, "sk");
    expect(skeleton).toBeNull();
  });

  it("returns null when combined chief+summary exceeds the budget", async () => {
    const longSummary = "x".repeat(700); // over 600-char combined cap
    mockCreate.mockResolvedValue(
      mockSkeletonResponse({
        ...FULL_INPUT,
        chiefComplaint: "short",
        clinicalSummary: longSummary,
      }),
    );
    const skeleton = await extractSkeleton(MIN_SOURCE, "sk");
    expect(skeleton).toBeNull();
  });

  it("returns null when required free-text fields are empty", async () => {
    mockCreate.mockResolvedValue(
      mockSkeletonResponse({ ...FULL_INPUT, chiefComplaint: "" }),
    );
    const skeleton = await extractSkeleton(MIN_SOURCE, "sk");
    expect(skeleton).toBeNull();
  });

  it("returns null when encounterType is invalid", async () => {
    mockCreate.mockResolvedValue(
      mockSkeletonResponse({ ...FULL_INPUT, encounterType: "made-up" }),
    );
    const skeleton = await extractSkeleton(MIN_SOURCE, "sk");
    expect(skeleton).toBeNull();
  });

  it("returns null on empty source (no API call made)", async () => {
    const skeleton = await extractSkeleton({}, "sk");
    expect(skeleton).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns null on API failure (safe fallback)", async () => {
    mockCreate.mockRejectedValue(new Error("network"));
    const skeleton = await extractSkeleton(MIN_SOURCE, "sk");
    expect(skeleton).toBeNull();
  });
});

describe("extractSkeleton — tolerant coercion", () => {
  it("silently drops non-string entries in array fields", async () => {
    mockCreate.mockResolvedValue(
      mockSkeletonResponse({
        ...FULL_INPUT,
        providers: ["Dr. A", 42, null, "Dr. B"],
      }),
    );
    const skeleton = await extractSkeleton(MIN_SOURCE, "sk");
    expect(skeleton?.providers).toEqual(["Dr. A", "Dr. B"]);
  });

  it("omits keyDates entries without a label", async () => {
    mockCreate.mockResolvedValue(
      mockSkeletonResponse({
        ...FULL_INPUT,
        keyDates: [{ iso: "2025-01-01" }, { label: "valid", iso: "2025-02-02" }],
      }),
    );
    const skeleton = await extractSkeleton(MIN_SOURCE, "sk");
    expect(skeleton?.keyDates).toEqual([
      { label: "valid", iso: "2025-02-02" },
    ]);
  });
});

describe("formatSkeletonBlock", () => {
  const skeleton: NoteSkeleton = {
    chiefComplaint: "CC text",
    clinicalSummary: "summary here",
    encounterType: "transfer",
    keyDates: [{ label: "Prior PCI", iso: "2025-09-26" }],
    primarySystems: ["cardiovascular"],
    providers: ["Dr. B", "CINRE"],
    criticalFindings: ["LVEF 50%"],
    confidence: "high",
  };

  it("renders a stable, deterministic block (ordering matters for caching)", () => {
    const a = formatSkeletonBlock(skeleton);
    const b = formatSkeletonBlock(skeleton);
    expect(a).toBe(b);
    expect(a).toContain("Chief complaint: CC text");
    expect(a).toContain("Encounter type: transfer");
    expect(a).toContain("Providers / facilities: Dr. B, CINRE");
    expect(a).toContain("Key dates: Prior PCI (2025-09-26)");
    expect(a).toContain("Summary: summary here");
  });

  it("omits empty-array sections cleanly", () => {
    const sparse: NoteSkeleton = {
      ...skeleton,
      primarySystems: [],
      providers: [],
      keyDates: [],
      criticalFindings: [],
    };
    const block = formatSkeletonBlock(sparse);
    expect(block).toContain("Chief complaint");
    expect(block).not.toContain("Primary systems");
    expect(block).not.toContain("Providers / facilities");
    expect(block).not.toContain("Key dates");
    expect(block).not.toContain("Critical findings");
  });
});
