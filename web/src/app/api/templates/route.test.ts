// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ─────────────────────────────────────────────────────────

const mockResolveAllTemplates = vi.fn();
vi.mock("@/lib/templates/server", () => ({
  resolveAllTemplates: mockResolveAllTemplates,
}));

const { GET } = await import("./route");

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/templates", () => {
  it("returns resolved templates", async () => {
    const templates = [{ id: "t1", name: "Default" }];
    mockResolveAllTemplates.mockResolvedValueOnce(templates);

    const req = new NextRequest("http://localhost:3000/api/templates");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(templates);
  });

  it("reads locale from NEXT_LOCALE cookie", async () => {
    mockResolveAllTemplates.mockResolvedValueOnce([]);

    const req = new NextRequest("http://localhost:3000/api/templates", {
      headers: { Cookie: "NEXT_LOCALE=en" },
    });
    await GET(req);
    expect(mockResolveAllTemplates).toHaveBeenCalledWith("en");
  });

  it("returns empty array on error", async () => {
    mockResolveAllTemplates.mockRejectedValueOnce(new Error("fail"));

    const req = new NextRequest("http://localhost:3000/api/templates");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });
});
