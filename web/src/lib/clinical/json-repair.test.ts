import { describe, it, expect } from "vitest";
import { extractJson } from "./json-repair";

describe("extractJson", () => {
  it("parses clean JSON directly", () => {
    const result = extractJson<{ name: string }>('{"name": "John"}');
    expect(result).toEqual({ name: "John" });
  });

  it("extracts JSON from surrounding text", () => {
    const result = extractJson<{ key: string }>(
      'Here is the result:\n{"key": "value"}\nDone.',
    );
    expect(result).toEqual({ key: "value" });
  });

  it("strips markdown code fences", () => {
    const input = '```json\n{"a": 1}\n```';
    expect(extractJson(input)).toEqual({ a: 1 });
  });

  it("strips code fences without language specifier", () => {
    const input = '```\n{"a": 1}\n```';
    expect(extractJson(input)).toEqual({ a: 1 });
  });

  it("handles trailing commas before } and ]", () => {
    const input = '{"items": [1, 2, 3,], "name": "test",}';
    expect(extractJson(input)).toEqual({ items: [1, 2, 3], name: "test" });
  });

  it("handles smart/curly quotes", () => {
    const input = "{\u201Cname\u201D: \u201CJohn\u201D}";
    expect(extractJson(input)).toEqual({ name: "John" });
  });

  it("handles unescaped newlines inside string values", () => {
    const input = '{"text": "line one\nline two"}';
    const result = extractJson<{ text: string }>(input);
    expect(result.text).toBe("line one\nline two");
  });

  it("handles unescaped tabs inside string values", () => {
    const input = '{"text": "col1\tcol2"}';
    const result = extractJson<{ text: string }>(input);
    expect(result.text).toBe("col1\tcol2");
  });

  it("handles nested objects", () => {
    const input = '{"outer": {"inner": "value"}}';
    expect(extractJson(input)).toEqual({ outer: { inner: "value" } });
  });

  it("handles unescaped quotes inside values", () => {
    // A quote that's clearly inside a value (followed by more text, not structural char)
    const input = '{"text": "She said "hello" to him"}';
    const result = extractJson<{ text: string }>(input);
    expect(result.text).toContain("hello");
  });

  it("throws when no JSON object is found", () => {
    expect(() => extractJson("just plain text")).toThrow(
      "No JSON object found",
    );
  });

  it("throws on completely malformed JSON", () => {
    expect(() => extractJson("{not json at all {{{")).toThrow();
  });

  it("handles multiple key-value pairs", () => {
    const input =
      '{"subjective": "Patient complains of pain.", "objective": "BP 120/80.", "assessment": "Hypertension.", "plan": "Continue meds."}';
    const result = extractJson<Record<string, string>>(input);
    expect(result.subjective).toBe("Patient complains of pain.");
    expect(result.plan).toBe("Continue meds.");
  });

  it("handles values with escaped characters that are already valid", () => {
    const input = '{"text": "line\\none"}';
    const result = extractJson<{ text: string }>(input);
    expect(result.text).toBe("line\none");
  });
});
