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
  IMPERSONATE_COOKIE: "mt_impersonate",
}));

const mockCookieStore = {
  get: vi.fn(),
};
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieStore),
}));

const mockAdminClient = {
  auth: {
    admin: {
      getUserById: vi.fn(),
    },
  },
};
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn().mockReturnValue(mockAdminClient),
}));

const { requireAuth } = await import("@/lib/supabase/auth");
const { GET } = await import("./route");

const mockRequireAuth = vi.mocked(requireAuth);

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/impersonate/status", () => {
  it("returns non-admin for regular users", async () => {
    mockRequireAuth.mockResolvedValueOnce({
      realUserEmail: "user@example.com",
    } as never);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isAdmin).toBe(false);
    expect(body.isImpersonating).toBe(false);
  });

  it("returns admin not impersonating when no cookie", async () => {
    mockCookieStore.get.mockReturnValueOnce(undefined);

    const res = await GET();
    const body = await res.json();
    expect(body.isAdmin).toBe(true);
    expect(body.isImpersonating).toBe(false);
  });

  it("returns admin impersonating with target info", async () => {
    mockCookieStore.get.mockReturnValueOnce({ value: "target-user" });
    mockAdminClient.auth.admin.getUserById.mockResolvedValueOnce({
      data: {
        user: {
          id: "target-user",
          email: "target@example.com",
          user_metadata: { full_name: "Target User" },
        },
      },
    });

    const res = await GET();
    const body = await res.json();
    expect(body.isAdmin).toBe(true);
    expect(body.isImpersonating).toBe(true);
    expect(body.target.email).toBe("target@example.com");
  });
});
