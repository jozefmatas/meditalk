// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  createMockSupabase,
  makeGetRequest,
  makeJsonRequest,
} from "@/test/route-helpers";

// ── Mocks ─────────────────────────────────────────────────────────

const mockSupabase = createMockSupabase();

vi.mock("@/lib/supabase/auth", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    userId: "user-123",
    supabase: mockSupabase,
    user: { email: "test@example.com" },
    isImpersonating: false,
    realUserId: "user-123",
  }),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  createAuditContext: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { GET, POST, DELETE } = await import("./route");

// ── Helpers ───────────────────────────────────────────────────────

function routeParams(encounterId = "v1") {
  return { params: Promise.resolve({ encounterId }) };
}

const defaultVisitMeta = {
  metadata: {
    files: [
      {
        id: "f1",
        name: "report.pdf",
        type: "application/pdf",
        path: "user-123/v1/report.pdf",
      },
    ],
  },
};

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.single.mockResolvedValue({
    data: defaultVisitMeta,
    error: null,
  });
  mockSupabase.eq.mockReturnThis();
});

describe("GET /api/encounters/[encounterId]/files", () => {
  it("returns 404 when visit not found", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: null,
      error: { message: "not found" },
    });
    const res = await GET(
      makeGetRequest("/api/encounters/v1/files"),
      routeParams(),
    );
    expect(res.status).toBe(404);
  });

  it("returns files array from metadata", async () => {
    const res = await GET(
      makeGetRequest("/api/encounters/v1/files"),
      routeParams(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toHaveLength(1);
    expect(body.files[0].name).toBe("report.pdf");
  });

  it("returns empty array when no files", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: { metadata: {} },
      error: null,
    });
    const res = await GET(
      makeGetRequest("/api/encounters/v1/files"),
      routeParams(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toEqual([]);
  });
});

describe("POST /api/encounters/[encounterId]/files (JSON mode)", () => {
  it("returns 404 when visit not found", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: null,
      error: { message: "not found" },
    });
    const req = makeJsonRequest("/api/encounters/v1/files", {
      files: [
        {
          id: "f2",
          name: "test.pdf",
          size: 100,
          type: "application/pdf",
          path: "user-123/v1/test.pdf",
        },
      ],
    });
    const res = await POST(req, routeParams());
    expect(res.status).toBe(404);
  });

  it("returns 400 when no files provided", async () => {
    const req = makeJsonRequest("/api/encounters/v1/files", { files: [] });
    const res = await POST(req, routeParams());
    expect(res.status).toBe(400);
  });

  it("returns 403 when file path doesn't match user", async () => {
    const req = makeJsonRequest("/api/encounters/v1/files", {
      files: [
        {
          id: "f2",
          name: "test.pdf",
          size: 100,
          type: "application/pdf",
          path: "other-user/v1/test.pdf",
        },
      ],
    });
    const res = await POST(req, routeParams());
    expect(res.status).toBe(403);
  });

  it("registers file metadata on success", async () => {
    const req = makeJsonRequest("/api/encounters/v1/files", {
      files: [
        {
          id: "f2",
          name: "test.pdf",
          size: 100,
          type: "application/pdf",
          path: "user-123/v1/test.pdf",
        },
      ],
    });
    const res = await POST(req, routeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toHaveLength(1);
    expect(body.files[0].extraction_status).toBe("pending");
  });
});

describe("DELETE /api/encounters/[encounterId]/files", () => {
  it("returns 400 when fileId query param is missing", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/encounters/v1/files",
      {
        method: "DELETE",
      },
    );
    const res = await DELETE(req, routeParams());
    expect(res.status).toBe(400);
  });

  it("returns 404 when file not found in metadata", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/encounters/v1/files?fileId=unknown",
      { method: "DELETE" },
    );
    const res = await DELETE(req, routeParams());
    expect(res.status).toBe(404);
  });

  it("removes file from storage and metadata", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/encounters/v1/files?fileId=f1",
      { method: "DELETE" },
    );
    const res = await DELETE(req, routeParams());
    expect(res.status).toBe(200);

    const storage = mockSupabase.storage.from("encounter-files");
    expect(storage.remove).toHaveBeenCalledWith(["user-123/v1/report.pdf"]);
  });
});
