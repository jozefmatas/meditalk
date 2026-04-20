import { describe, it, expect } from "vitest";
import {
  extractTemporalAnchor,
  resolveTimelineCoherence,
} from "./timeline-coherence";
import {
  emptyExtractedFacts,
  type ExtractedFact,
  type ExtractedFacts,
} from "./fact-extraction";

function symptom(value: string): ExtractedFact {
  return {
    category: "symptoms",
    value,
    source: { type: "transcript", sourceIndex: 0, evidence: value },
  };
}
function measurement(value: string): ExtractedFact {
  return {
    category: "measurements",
    value,
    source: { type: "transcript", sourceIndex: 0, evidence: value },
  };
}
function facts(...items: ExtractedFact[]): ExtractedFacts {
  const f = emptyExtractedFacts();
  for (const i of items) {
    // push into the category declared on the item
    (f[i.category] as ExtractedFact[]).push(i);
  }
  return f;
}

describe("extractTemporalAnchor", () => {
  it("identifies a clock-time anchor", () => {
    expect(extractTemporalAnchor("bolesť od 13:00").kind).toBe("clock");
    expect(extractTemporalAnchor("chest pain since 14:02").precision).toBe(3);
  });

  it("identifies relative anchors (Slovak + English)", () => {
    expect(extractTemporalAnchor("bolesť od rána").kind).toBe("relative");
    expect(extractTemporalAnchor("chest pain this morning").kind).toBe(
      "relative",
    );
  });

  it("identifies duration anchors", () => {
    expect(extractTemporalAnchor("3 hodiny bolesť").kind).toBe("duration");
    expect(extractTemporalAnchor("chest pain for 2 hours").kind).toBe(
      "duration",
    );
  });

  it("returns 'none' when no temporal phrase is present", () => {
    const a = extractTemporalAnchor("bolesť na hrudi");
    expect(a.kind).toBe("none");
    expect(a.precision).toBe(0);
  });

  it("prefers clock over relative when both are present", () => {
    const a = extractTemporalAnchor("od rána, presne od 13:00");
    expect(a.kind).toBe("clock");
  });
});

describe("resolveTimelineCoherence — symptoms", () => {
  it("keeps the clock-time variant and drops the morning variant", () => {
    const input = facts(
      symptom("bolesť na hrudi od rána"),
      symptom("bolesť na hrudi od 13:00"),
    );
    const { facts: resolved, conflicts } = resolveTimelineCoherence(input);
    expect(resolved.symptoms).toHaveLength(1);
    expect(resolved.symptoms[0].value).toContain("13:00");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].keptAnchor.kind).toBe("clock");
    expect(conflicts[0].droppedAnchor.kind).toBe("relative");
  });

  it("keeps the relative variant over a no-anchor variant", () => {
    const input = facts(
      symptom("bolesť na hrudi"),
      symptom("bolesť na hrudi od rána"),
    );
    const { facts: resolved } = resolveTimelineCoherence(input);
    expect(resolved.symptoms).toHaveLength(1);
    expect(resolved.symptoms[0].value).toContain("od rána");
  });

  it("keeps BOTH when precisions are equal (progression, not conflict)", () => {
    const input = facts(
      symptom("bolesť na hrudi od 13:00"),
      symptom("bolesť na hrudi od 14:30"),
    );
    const { facts: resolved, conflicts } = resolveTimelineCoherence(input);
    expect(resolved.symptoms).toHaveLength(2);
    expect(conflicts).toHaveLength(0);
  });

  it("does NOT collapse different subjects", () => {
    const input = facts(
      symptom("bolesť hlavy od rána"),
      symptom("bolesť na hrudi od 13:00"),
    );
    const { facts: resolved, conflicts } = resolveTimelineCoherence(input);
    expect(resolved.symptoms).toHaveLength(2);
    expect(conflicts).toHaveLength(0);
  });

  it("handles diacritics + case differences in subject matching", () => {
    const input = facts(
      symptom("BOLESŤ hlavy od rána"),
      symptom("bolest hlavy od 13:00"),
    );
    const { facts: resolved } = resolveTimelineCoherence(input);
    expect(resolved.symptoms).toHaveLength(1);
    expect(resolved.symptoms[0].value).toContain("13:00");
  });
});

describe("resolveTimelineCoherence — isolation of other categories", () => {
  it("does NOT touch measurement time-series (BP at 14:02, 14:31 …)", () => {
    const input = facts(
      measurement("TK 150/80 mmHg (14:02)"),
      measurement("TK 145/80 mmHg (14:31)"),
      measurement("TK 143/80 mmHg (15:12)"),
    );
    const { facts: resolved, conflicts } = resolveTimelineCoherence(input);
    expect(resolved.measurements).toHaveLength(3);
    expect(conflicts).toHaveLength(0);
  });

  it("returns an identical facts object when no symptoms/CC are present", () => {
    const input = emptyExtractedFacts();
    const { facts: resolved, conflicts } = resolveTimelineCoherence(input);
    expect(conflicts).toHaveLength(0);
    for (const cat of Object.keys(resolved) as (keyof ExtractedFacts)[]) {
      if (cat === "usage") continue;
      expect((resolved[cat] as unknown[]).length).toBe(0);
    }
  });
});
