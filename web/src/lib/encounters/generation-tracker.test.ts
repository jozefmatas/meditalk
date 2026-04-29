import { describe, it, expect, vi, beforeEach } from "vitest";
import { GenerationTracker } from "./generation-tracker";

let tracker: GenerationTracker;

beforeEach(() => {
  tracker = new GenerationTracker();
  localStorage.clear();
});

describe("GenerationTracker", () => {
  describe("isActive / start / complete", () => {
    it("starts inactive", () => {
      expect(tracker.isActive("v1")).toBe(false);
    });

    it("start returns true on first call, false on duplicate", () => {
      expect(tracker.start("v1")).toBe(true);
      expect(tracker.isActive("v1")).toBe(true);
      expect(tracker.start("v1")).toBe(false);
    });

    it("complete clears active state and emits generation-done", () => {
      tracker.start("v1");
      const spy = vi.fn();
      window.addEventListener("generation-done", spy);

      tracker.complete("v1");

      expect(tracker.isActive("v1")).toBe(false);
      expect(spy).toHaveBeenCalledOnce();
      const event = spy.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toEqual({ visitId: "v1" });

      window.removeEventListener("generation-done", spy);
    });
  });

  describe("cache", () => {
    const entry = {
      sections: [{ id: "s1", title: "Section 1", content: "content" }],
      sectionIds: ["s1"],
      sectionLabels: { s1: "Section 1" },
    };

    it("getCache returns null when empty", () => {
      expect(tracker.getCache("v1")).toBeNull();
    });

    it("updateCache stores in memory and emits streaming-update", () => {
      const spy = vi.fn();
      window.addEventListener("streaming-update", spy);

      tracker.updateCache("v1", entry);

      expect(tracker.getCache("v1")).toEqual(entry);
      expect(spy).toHaveBeenCalledOnce();

      window.removeEventListener("streaming-update", spy);
    });

    it("updateCache merges partial updates", () => {
      tracker.updateCache("v1", { sectionIds: ["s1"], sectionLabels: {} });
      tracker.updateCache("v1", {
        sections: [{ id: "s1", title: "T", content: "C" }],
      });

      const cached = tracker.getCache("v1");
      expect(cached?.sectionIds).toEqual(["s1"]);
      expect(cached?.sections).toHaveLength(1);
    });

    it("clearCache removes from memory and localStorage", () => {
      tracker.updateCache("v1", entry);
      expect(tracker.getCache("v1")).not.toBeNull();

      tracker.clearCache("v1");
      expect(tracker.getCache("v1")).toBeNull();
      expect(localStorage.getItem("meditalk:streaming:v1")).toBeNull();
    });

    it("getCache falls back to localStorage", () => {
      localStorage.setItem("meditalk:streaming:v1", JSON.stringify(entry));

      expect(tracker.getCache("v1")).toEqual(entry);
    });

    it("complete also clears cache", () => {
      tracker.start("v1");
      tracker.updateCache("v1", entry);

      tracker.complete("v1");

      expect(tracker.getCache("v1")).toBeNull();
    });
  });
});
