import { describe, it, expect, vi, beforeEach } from "vitest";
import { sortTemplatesByUsage, fetchTemplateUsage } from "./usage";
import type { Template } from "./types";

function makeTemplate(id: string): Template {
  return {
    id,
    name: { sk: id },
    description: { sk: id },
    sections: [],
  };
}

describe("sortTemplatesByUsage", () => {
  const templates = [
    makeTemplate("t1"),
    makeTemplate("t2"),
    makeTemplate("t3"),
  ];

  it("sorts templates by usage count descending", () => {
    const usage = { t1: 1, t2: 5, t3: 3 };
    const sorted = sortTemplatesByUsage(templates, usage);
    expect(sorted.map((t) => t.id)).toEqual(["t2", "t3", "t1"]);
  });

  it("treats missing usage as 0", () => {
    const usage = { t2: 2 };
    const sorted = sortTemplatesByUsage(templates, usage);
    expect(sorted[0].id).toBe("t2");
  });

  it("preserves original order for equal usage", () => {
    const usage = {};
    const sorted = sortTemplatesByUsage(templates, usage);
    expect(sorted.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("does not mutate the original array", () => {
    const usage = { t1: 10 };
    const sorted = sortTemplatesByUsage(templates, usage);
    expect(sorted).not.toBe(templates);
    expect(templates[0].id).toBe("t1");
  });

  it("handles empty templates array", () => {
    const sorted = sortTemplatesByUsage([], { t1: 5 });
    expect(sorted).toEqual([]);
  });

  it("handles empty usage map", () => {
    const sorted = sortTemplatesByUsage(templates, {});
    expect(sorted).toHaveLength(3);
  });
});

describe("fetchTemplateUsage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns usage map from API", async () => {
    const mockUsage = { t1: 3, t2: 7 };
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockUsage),
    } as Response);

    const result = await fetchTemplateUsage();
    expect(result).toEqual(mockUsage);
    expect(fetch).toHaveBeenCalledWith("/api/templates/usage");
  });

  it("returns empty map on API error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const result = await fetchTemplateUsage();
    expect(result).toEqual({});
  });

  it("returns empty map on network failure", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("Network error"));

    const result = await fetchTemplateUsage();
    expect(result).toEqual({});
  });
});
