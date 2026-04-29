// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeGetRequest } from "@/test/route-helpers";

// ── Mocks ─────────────────────────────────────────────────────────

const mockSearchIcd = vi.fn();
vi.mock("@/lib/lookup/icd", () => ({
  searchIcd: mockSearchIcd,
}));

const { GET } = await import("./route");

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/icd-search", () => {
  it("returns empty results for short query", async () => {
    const res = await GET(makeGetRequest("/api/icd-search", { q: "A" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([]);
    expect(mockSearchIcd).not.toHaveBeenCalled();
  });

  it("searches with default locale", async () => {
    mockSearchIcd.mockReturnValueOnce([
      { code: "J06", description: "Upper respiratory" },
    ]);

    const res = await GET(makeGetRequest("/api/icd-search", { q: "J06" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(mockSearchIcd).toHaveBeenCalledWith("J06", 20, "en");
  });

  it("passes locale parameter", async () => {
    mockSearchIcd.mockReturnValueOnce([]);

    await GET(makeGetRequest("/api/icd-search", { q: "chest", locale: "sk" }));
    expect(mockSearchIcd).toHaveBeenCalledWith("chest", 20, "sk");
  });
});
