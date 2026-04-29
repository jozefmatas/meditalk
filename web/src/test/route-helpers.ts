import { vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Creates a mock Supabase client with chainable query builder methods.
 * Each test file should call this to get an isolated mock.
 */
export function createMockSupabase() {
  const mock = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    rpc: vi.fn().mockResolvedValue({ error: null }),
    storage: {
      from: vi.fn().mockReturnValue({
        download: vi.fn().mockResolvedValue({ data: null, error: null }),
        upload: vi.fn().mockResolvedValue({ error: null }),
        remove: vi.fn().mockResolvedValue({ error: null }),
      }),
    },
  };
  return mock;
}

/** Build a NextRequest for JSON route handlers. */
export function makeJsonRequest(
  url: string,
  body: Record<string, unknown>,
  method = "POST",
) {
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

/** Build a NextRequest for GET endpoints with query params. */
export function makeGetRequest(url: string, params?: Record<string, string>) {
  const u = new URL(`http://localhost:3000${url}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  }
  return new NextRequest(u);
}
