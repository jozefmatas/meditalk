// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeGetRequest } from "@/test/route-helpers";

// ── Mocks ─────────────────────────────────────────────────────────

const mockSearchMedications = vi.fn();
vi.mock("@/lib/lookup/medications", () => ({
  searchMedications: mockSearchMedications,
}));

const { GET } = await import("./route");

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/medication-search", () => {
  it("returns empty results for short query", async () => {
    const res = await GET(makeGetRequest("/api/medication-search", { q: "A" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([]);
    expect(mockSearchMedications).not.toHaveBeenCalled();
  });

  it("searches with default locale (sk)", async () => {
    mockSearchMedications.mockReturnValueOnce([{ name: "Ibuprofen 400mg" }]);

    const res = await GET(
      makeGetRequest("/api/medication-search", { q: "ibuprofen" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(mockSearchMedications).toHaveBeenCalledWith("ibuprofen", 20, "sk");
  });

  it("passes locale parameter", async () => {
    mockSearchMedications.mockReturnValueOnce([]);

    await GET(
      makeGetRequest("/api/medication-search", { q: "aspirin", locale: "cs" }),
    );
    expect(mockSearchMedications).toHaveBeenCalledWith("aspirin", 20, "cs");
  });
});
