import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  patchEncounter,
  patchEncounterStatus,
  patchEncounterOrThrow,
} from "./api";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("patchEncounter", () => {
  it("sends PATCH with JSON body", async () => {
    const mockRes = new Response("ok", { status: 200 });
    vi.spyOn(global, "fetch").mockResolvedValue(mockRes);

    const res = await patchEncounter("v1", { status: "completed" });

    expect(fetch).toHaveBeenCalledWith("/api/encounters/v1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    expect(res).toBe(mockRes);
  });

  it("returns null on network failure", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new TypeError("Network error"));

    const res = await patchEncounter("v1", { status: "completed" });
    expect(res).toBeNull();
  });
});

describe("patchEncounterStatus", () => {
  it("emits encounter-update and sends PATCH", async () => {
    const mockRes = new Response("ok", { status: 200 });
    vi.spyOn(global, "fetch").mockResolvedValue(mockRes);
    const spy = vi.fn();
    window.addEventListener("encounter-update", spy);

    await patchEncounterStatus("v1", "completed");

    expect(spy).toHaveBeenCalledOnce();
    const event = spy.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({ id: "v1", status: "completed" });
    expect(fetch).toHaveBeenCalledOnce();

    window.removeEventListener("encounter-update", spy);
  });

  it("merges extraPatch into the request body", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("ok"));

    await patchEncounterStatus("v1", "started", {
      metadata: { generation_pending: null },
    });

    const body = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(body).toEqual({
      status: "started",
      metadata: { generation_pending: null },
    });
  });
});

describe("patchEncounterOrThrow", () => {
  it("returns response on success", async () => {
    const mockRes = new Response("ok", { status: 200 });
    vi.spyOn(global, "fetch").mockResolvedValue(mockRes);

    const res = await patchEncounterOrThrow("v1", { title: "New title" });
    expect(res).toBe(mockRes);
  });

  it("throws on non-ok response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("error", { status: 500 }),
    );

    await expect(
      patchEncounterOrThrow("v1", { title: "New title" }),
    ).rejects.toThrow("Failed to update encounter: 500");
  });
});
