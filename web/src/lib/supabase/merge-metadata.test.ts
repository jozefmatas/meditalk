import { describe, it, expect, vi, beforeEach } from "vitest";
import { mergeVisitMetadata } from "./merge-metadata";

// Mock the retry module to call the operation directly
vi.mock("./retry", () => ({
  retrySupabaseCall: vi.fn(async (op: () => Promise<unknown>) => op()),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function createMockSupabase(rpcResult: { data?: unknown; error?: unknown }) {
  return {
    rpc: vi.fn().mockResolvedValue(rpcResult),
  } as unknown as Parameters<typeof mergeVisitMetadata>[0];
}

describe("mergeVisitMetadata", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls RPC with correct parameters", async () => {
    const supabase = createMockSupabase({
      data: { transcript: "hello", doctor_notes: "note" },
    });

    const result = await mergeVisitMetadata(supabase, "visit-1", {
      transcript: "hello",
    });

    expect(supabase.rpc).toHaveBeenCalledWith("merge_visit_metadata", {
      p_visit_id: "visit-1",
      p_partial: { transcript: "hello" },
    });
    expect(result).toEqual({ transcript: "hello", doctor_notes: "note" });
  });

  it("returns merged metadata on success", async () => {
    const merged = {
      transcript: "updated",
      doctor_notes: "existing",
      template_id: "soap_v1",
    };
    const supabase = createMockSupabase({ data: merged });

    const result = await mergeVisitMetadata(supabase, "visit-1", {
      transcript: "updated",
    });

    expect(result).toEqual(merged);
  });

  it("handles null deletion keys", async () => {
    const merged = { doctor_notes: "kept" };
    const supabase = createMockSupabase({ data: merged });

    const result = await mergeVisitMetadata(supabase, "visit-1", {
      generation_pending: null,
      recording_session: null,
    });

    expect(supabase.rpc).toHaveBeenCalledWith("merge_visit_metadata", {
      p_visit_id: "visit-1",
      p_partial: { generation_pending: null, recording_session: null },
    });
    expect(result).toEqual(merged);
  });

  it("throws on RPC error", async () => {
    const supabase = createMockSupabase({
      error: new Error("Visit not found"),
    });

    await expect(
      mergeVisitMetadata(supabase, "bad-id", { transcript: "x" }),
    ).rejects.toThrow("Visit not found");
  });

  it("throws string errors as Error instances", async () => {
    const supabase = createMockSupabase({
      error: "something went wrong",
    });

    await expect(
      mergeVisitMetadata(supabase, "visit-1", { transcript: "x" }),
    ).rejects.toThrow("something went wrong");
  });

  it("returns empty object when RPC returns null data", async () => {
    const supabase = createMockSupabase({ data: null });

    const result = await mergeVisitMetadata(supabase, "visit-1", {
      transcript: "x",
    });

    expect(result).toEqual({});
  });
});
