// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeJsonRequest } from "@/test/route-helpers";

// ── Mocks ─────────────────────────────────────────────────────────

const mockResolveIcdCodes = vi.fn();
vi.mock("@/lib/lookup/icd", () => ({
  resolveIcdCodes: mockResolveIcdCodes,
}));

const { POST } = await import("./route");

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/icd-resolve", () => {
  it("returns empty results when codes is empty", async () => {
    const res = await POST(makeJsonRequest("/api/icd-resolve", { codes: [] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([]);
  });

  it("returns empty results when codes is not an array", async () => {
    const res = await POST(
      makeJsonRequest("/api/icd-resolve", { codes: "J06" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([]);
  });

  it("resolves codes with locale", async () => {
    mockResolveIcdCodes.mockReturnValueOnce([
      {
        code: "J06.9",
        description: "Acute upper respiratory infection",
        found: true,
      },
    ]);

    const res = await POST(
      makeJsonRequest("/api/icd-resolve", { codes: ["J06.9"], locale: "sk" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].inputCode).toBe("J06.9");
    expect(body.results[0].found).toBe(true);
    expect(mockResolveIcdCodes).toHaveBeenCalledWith(["J06.9"], "sk");
  });
});
