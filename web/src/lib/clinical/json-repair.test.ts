import { describe, it, expect } from "vitest";
import { extractJson, closeTruncatedJson } from "./json-repair";

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

  it("recovers partial facts from JSON truncated mid-string", () => {
    // Simulates an LLM hitting max_tokens inside an evidence quote.
    const input = `{
  "demographics": [
    {"category": "demographics", "value": "Pacient Solak", "source": {"type": "transcript", "sourceIndex": 0, "evidence": "pán Solak"}}
  ],
  "symptoms": [
    {"category": "symptoms", "value": "bolesť na hrudi", "source": {"type": "transcript", "sourceIndex": 0, "evidence": "bolesť na hru`;
    const result = extractJson<{
      demographics: Array<{ value: string }>;
      symptoms?: Array<unknown>;
    }>(input);
    expect(result.demographics).toHaveLength(1);
    expect(result.demographics[0].value).toBe("Pacient Solak");
  });

  it("recovers from JSON truncated mid-object inside an array", () => {
    const input = `{
  "items": [
    {"id": 1, "name": "first"},
    {"id": 2, "name": "second"},
    {"id": 3, "name": "thir`;
    const result = extractJson<{ items: Array<{ id: number; name: string }> }>(
      input,
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({ id: 1, name: "first" });
    expect(result.items[1]).toEqual({ id: 2, name: "second" });
  });

  it("recovers from JSON truncated right after a completed value", () => {
    // Truncated right after "transcript" — the next field was a number that
    // was never emitted.
    const input = `{"source": {"type": "transcript",`;
    const result = extractJson<{ source: { type: string } }>(input);
    expect(result.source.type).toBe("transcript");
  });

  it("still throws on completely garbage input after all repair stages", () => {
    expect(() => extractJson("{not json at all {{{")).toThrow();
  });
});

describe("closeTruncatedJson", () => {
  it("returns input unchanged when JSON is already complete", () => {
    const input = '{"a": 1, "b": [2, 3]}';
    expect(closeTruncatedJson(input)).toBe(input);
  });

  it("closes an open object by appending } (drops trailing number that may be truncated)", () => {
    // `2` at end-of-input might be a truncated `200` — safest to drop the
    // trailing `"b": 2` entirely and keep the fully-completed `"a": 1`.
    const input = '{"a": 1, "b": 2';
    const closed = closeTruncatedJson(input);
    expect(JSON.parse(closed)).toEqual({ a: 1 });
  });

  it("closes an open object when the last value is fully delimited", () => {
    const input = '{"a": 1, "b": 2,';
    const closed = closeTruncatedJson(input);
    expect(JSON.parse(closed)).toEqual({ a: 1, b: 2 });
  });

  it("closes an unterminated string by truncating to the last safe value", () => {
    const input = '{"a": "done", "b": "halfway th';
    const closed = closeTruncatedJson(input);
    // "a" was fully emitted before the truncation, "b" was not — we should
    // at minimum parse successfully and get "a".
    const parsed = JSON.parse(closed) as { a: string };
    expect(parsed.a).toBe("done");
  });

  it("closes nested arrays and objects in LIFO order", () => {
    const input = '{"outer": [{"inner": "ok"}, {"inner": "tru';
    const closed = closeTruncatedJson(input);
    const parsed = JSON.parse(closed) as {
      outer: Array<{ inner: string }>;
    };
    expect(parsed.outer[0].inner).toBe("ok");
  });

  it("strips a trailing comma left by the cut", () => {
    const input = '{"items": [1, 2, 3,';
    const closed = closeTruncatedJson(input);
    expect(JSON.parse(closed)).toEqual({ items: [1, 2, 3] });
  });

  it("treats key-strings differently from value-strings", () => {
    // A key-string followed by `:` must NOT be snapshotted as a valid cut.
    const input = '{"key"';
    const closed = closeTruncatedJson(input);
    // No value was ever emitted — the recovery should return the input
    // unchanged (snapshots is empty), and the outer parser will fail.
    expect(closed).toBe(input);
  });

  it("returns the input unchanged when nothing is salvageable", () => {
    const input = "{{{";
    expect(closeTruncatedJson(input)).toBe(input);
  });
});
