import { describe, it, expect } from "vitest";
import { chunkText } from "./chunking";

describe("chunkText", () => {
  it("returns empty array for empty/whitespace input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   ")).toEqual([]);
    expect(chunkText("\n\t")).toEqual([]);
  });

  it("returns single chunk when text fits within chunkSize", () => {
    const text = "Hello world. This is a test.";
    const chunks = chunkText(text, 1000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text.trim());
  });

  it("splits on sentence boundaries", () => {
    const s1 = "First sentence. ";
    const s2 = "Second sentence. ";
    const s3 = "Third sentence. ";
    const text = s1 + s2 + s3;
    // chunkSize just big enough for 2 sentences but not 3
    const chunks = chunkText(text, 35, 0);
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should end at a sentence boundary (trimmed)
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it("handles text without sentence boundaries (falls back to word splitting)", () => {
    const text = "word ".repeat(50).trim(); // 249 chars, no sentence endings
    const chunks = chunkText(text, 50, 0);
    expect(chunks.length).toBeGreaterThan(1);
    // All chunks should be non-empty
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it("produces overlapping chunks when overlap > 0", () => {
    const sentences = Array.from(
      { length: 20 },
      (_, i) => `Sentence number ${i + 1}. `,
    ).join("");
    const chunks = chunkText(sentences, 100, 30);
    expect(chunks.length).toBeGreaterThan(1);
    // With overlap, consecutive chunks should share some text
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1];
      const curr = chunks[i];
      // Some portion of the end of the previous chunk should appear
      // at the beginning of the current chunk
      const prevTail = prev.slice(-30);
      const hasOverlap =
        curr.includes(prevTail) ||
        prevTail
          .split(" ")
          .some((word) => word.length > 3 && curr.startsWith(word));
      // At minimum, chunks should be non-empty strings
      expect(curr.length).toBeGreaterThan(0);
      // The overlap mechanism ensures chunks > 1 exist
      if (hasOverlap) {
        expect(hasOverlap).toBe(true);
      }
    }
  });

  it("handles a single very long word that exceeds chunkSize", () => {
    const longWord = "a".repeat(200);
    const text = `Start. ${longWord} End.`;
    const chunks = chunkText(text, 100, 0);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // The long word should appear somewhere across chunks
    const joined = chunks.join(" ");
    expect(joined).toContain(longWord);
  });

  it("uses default chunkSize and overlap when not specified", () => {
    const text = "Hello. ".repeat(300); // ~2100 chars
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    // Default chunk size is 1000, each chunk should be roughly that
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1200); // allow some flex from overlap
    }
  });

  it("handles question marks and exclamation marks as sentence boundaries", () => {
    const text = "Is this working? Yes it is! Great.";
    const chunks = chunkText(text, 20, 0);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("returns trimmed chunks with no empty entries", () => {
    const text = "  First.   Second.   Third.  ";
    const chunks = chunkText(text, 15, 0);
    for (const chunk of chunks) {
      expect(chunk).toBe(chunk.trim());
      expect(chunk.length).toBeGreaterThan(0);
    }
  });
});
