// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/auth", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    realUserEmail: "admin@meditalk.com",
  }),
}));

vi.mock("@/lib/admin", () => ({
  isAdminEmail: vi.fn((email: string) => email === "admin@meditalk.com"),
}));

const { requireAuth } = await import("@/lib/supabase/auth");
const { GET } = await import("./route");

const mockRequireAuth = vi.mocked(requireAuth);

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/auth/admin-check", () => {
  it("returns isAdmin: true for admin email", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isAdmin).toBe(true);
  });

  it("returns isAdmin: false for non-admin email", async () => {
    mockRequireAuth.mockResolvedValueOnce({
      realUserEmail: "user@example.com",
    } as never);

    const res = await GET();
    const body = await res.json();
    expect(body.isAdmin).toBe(false);
  });

  it("returns isAdmin: false when auth fails", async () => {
    mockRequireAuth.mockRejectedValueOnce(new Error("no auth"));

    const res = await GET();
    const body = await res.json();
    expect(body.isAdmin).toBe(false);
  });
});
