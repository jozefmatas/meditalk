// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ─────────────────────────────────────────────────────────

const mockResolveTemplate = vi.fn();
vi.mock("@/lib/templates/server", () => ({
  resolveTemplate: mockResolveTemplate,
}));

const { GET } = await import("./route");

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/templates/[id]", () => {
  it("returns template by id", async () => {
    const template = { id: "t1", name: "Default", sections: [] };
    mockResolveTemplate.mockResolvedValueOnce(template);

    const req = new NextRequest("http://localhost:3000/api/templates/t1");
    const res = await GET(req, { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("t1");
  });

  it("returns 404 when template not found", async () => {
    mockResolveTemplate.mockRejectedValueOnce(new Error("not found"));

    const req = new NextRequest("http://localhost:3000/api/templates/unknown");
    const res = await GET(req, { params: Promise.resolve({ id: "unknown" }) });
    expect(res.status).toBe(404);
  });
});
