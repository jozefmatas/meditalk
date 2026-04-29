import { describe, it, expect, vi } from "vitest";
import { emit, on } from "./events";

describe("events", () => {
  it("emit dispatches a CustomEvent on window", () => {
    const spy = vi.fn();
    window.addEventListener("encounter-update", spy);

    emit("encounter-update", { id: "v1", status: "completed" });

    expect(spy).toHaveBeenCalledOnce();
    const event = spy.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({ id: "v1", status: "completed" });

    window.removeEventListener("encounter-update", spy);
  });

  it("on registers a typed listener and returns cleanup", () => {
    const handler = vi.fn();
    const cleanup = on("generation-done", handler);

    emit("generation-done", { visitId: "v2" });
    expect(handler).toHaveBeenCalledWith({ visitId: "v2" });

    cleanup();
    emit("generation-done", { visitId: "v3" });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("supports all event types without type errors", () => {
    const handlers = {
      update: vi.fn(),
      delete: vi.fn(),
      refresh: vi.fn(),
    };

    const cleanups = [
      on("encounter-update", handlers.update),
      on("encounter-delete", handlers.delete),
      on("sidebar-refresh", handlers.refresh),
    ];

    emit("encounter-update", { id: "v1", title: "Test" });
    emit("encounter-delete", { id: "v1" });
    emit("sidebar-refresh", {
      encounter: { id: "v1" } as Parameters<
        typeof handlers.refresh
      >[0]["encounter"],
    });

    expect(handlers.update).toHaveBeenCalledOnce();
    expect(handlers.delete).toHaveBeenCalledOnce();
    expect(handlers.refresh).toHaveBeenCalledOnce();

    cleanups.forEach((c) => c());
  });
});
