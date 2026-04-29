// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { makeJsonRequest } from "@/test/route-helpers";

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/auth", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    userId: "admin-123",
    realUserId: "admin-123",
    realUserEmail: "admin@meditalk.com",
    user: { email: "admin@meditalk.com" },
  }),
}));

vi.mock("@/lib/admin", () => ({
  isAdminEmail: vi.fn((email: string) => email === "admin@meditalk.com"),
  IMPERSONATE_COOKIE: "mt_impersonate",
}));

const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
};
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieStore),
}));

const mockAdminClient = {
  auth: {
    admin: {
      listUsers: vi.fn(),
      getUserById: vi.fn(),
    },
  },
};
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn().mockReturnValue(mockAdminClient),
}));

vi.mock("@/lib/env/server", () => ({
  serverEnv: { NODE_ENV: "test" },
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

const { requireAuth } = await import("@/lib/supabase/auth");
const { isAdminEmail } = await import("@/lib/admin");
const { GET, POST, DELETE } = await import("./route");

const mockRequireAuth = vi.mocked(requireAuth);
const mockIsAdminEmail = vi.mocked(isAdminEmail);

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockIsAdminEmail.mockImplementation(
    (email: string) => email === "admin@meditalk.com",
  );
});

describe("GET /api/admin/impersonate (list users)", () => {
  it("returns 403 for non-admin", async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: "user-1",
      realUserId: "user-1",
      realUserEmail: "user@example.com",
    } as never);

    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns user list for admin", async () => {
    mockAdminClient.auth.admin.listUsers.mockResolvedValueOnce({
      data: {
        users: [
          {
            id: "u1",
            email: "doc@example.com",
            user_metadata: { full_name: "Dr. Smith" },
            created_at: "2025-01-01",
            last_sign_in_at: "2025-01-15",
          },
        ],
      },
      error: null,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toHaveLength(1);
    expect(body.users[0].name).toBe("Dr. Smith");
  });
});

describe("POST /api/admin/impersonate", () => {
  it("returns 400 when userId is missing", async () => {
    const res = await POST(makeJsonRequest("/api/admin/impersonate", {}));
    expect(res.status).toBe(400);
  });

  it("returns 404 when target user not found", async () => {
    mockAdminClient.auth.admin.getUserById.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "not found" },
    });

    const res = await POST(
      makeJsonRequest("/api/admin/impersonate", { userId: "unknown" }),
    );
    expect(res.status).toBe(404);
  });

  it("sets impersonation cookie on success", async () => {
    mockAdminClient.auth.admin.getUserById.mockResolvedValueOnce({
      data: {
        user: {
          id: "target-user",
          email: "target@example.com",
          user_metadata: { full_name: "Target User" },
        },
      },
      error: null,
    });

    const res = await POST(
      makeJsonRequest("/api/admin/impersonate", { userId: "target-user" }),
    );
    expect(res.status).toBe(200);
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      "mt_impersonate",
      "target-user",
      expect.objectContaining({ httpOnly: true }),
    );
  });
});

describe("DELETE /api/admin/impersonate", () => {
  it("clears the impersonation cookie", async () => {
    const req = new NextRequest("http://localhost:3000/api/admin/impersonate", {
      method: "DELETE",
    });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      "mt_impersonate",
      "",
      expect.objectContaining({ maxAge: 0 }),
    );
  });
});
