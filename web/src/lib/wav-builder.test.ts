import { describe, it, expect } from "vitest";
import { WavBuilder } from "./wav-builder";

/** Create a base64-encoded Int16 PCM chunk with `numSamples` silent samples. */
function makeSilentChunk(numSamples: number): string {
  const buffer = new ArrayBuffer(numSamples * 2);
  // All zeros = silence
  const bytes = new Uint8Array(buffer);
  return btoa(String.fromCharCode(...bytes));
}

/** Create a base64-encoded Int16 PCM chunk with a constant sample value. */
function makeConstantChunk(numSamples: number, value: number): string {
  const int16 = new Int16Array(numSamples);
  int16.fill(value);
  const bytes = new Uint8Array(int16.buffer);
  return btoa(String.fromCharCode(...bytes));
}

describe("WavBuilder", () => {
  it("starts with no data", () => {
    const builder = new WavBuilder();
    expect(builder.hasData).toBe(false);
    expect(builder.getDurationMs()).toBe(0);
  });

  it("accumulates chunks and reports duration", () => {
    const builder = new WavBuilder();

    // 4000 samples at 16 kHz = 250 ms
    builder.addChunk(makeSilentChunk(4000));
    expect(builder.hasData).toBe(true);
    expect(builder.getDurationMs()).toBe(250);

    // Add another 250 ms
    builder.addChunk(makeSilentChunk(4000));
    expect(builder.getDurationMs()).toBe(500);
  });

  it("builds a valid WAV blob", () => {
    const builder = new WavBuilder();
    builder.addChunk(makeSilentChunk(4000));

    const blob = builder.toBlob();
    expect(blob.type).toBe("audio/wav");
    // 44 byte header + 8000 bytes PCM (4000 samples * 2 bytes)
    expect(blob.size).toBe(44 + 8000);
  });

  it("WAV header has correct RIFF structure", async () => {
    const builder = new WavBuilder();
    builder.addChunk(makeSilentChunk(100));

    const blob = builder.toBlob();
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);

    // RIFF header
    expect(
      String.fromCharCode(
        view.getUint8(0),
        view.getUint8(1),
        view.getUint8(2),
        view.getUint8(3),
      ),
    ).toBe("RIFF");

    // WAVE format
    expect(
      String.fromCharCode(
        view.getUint8(8),
        view.getUint8(9),
        view.getUint8(10),
        view.getUint8(11),
      ),
    ).toBe("WAVE");

    // fmt sub-chunk
    expect(
      String.fromCharCode(
        view.getUint8(12),
        view.getUint8(13),
        view.getUint8(14),
        view.getUint8(15),
      ),
    ).toBe("fmt ");

    // AudioFormat = 1 (PCM)
    expect(view.getUint16(20, true)).toBe(1);

    // NumChannels = 1 (mono)
    expect(view.getUint16(22, true)).toBe(1);

    // SampleRate = 16000
    expect(view.getUint32(24, true)).toBe(16000);

    // BitsPerSample = 16
    expect(view.getUint16(34, true)).toBe(16);

    // data sub-chunk
    expect(
      String.fromCharCode(
        view.getUint8(36),
        view.getUint8(37),
        view.getUint8(38),
        view.getUint8(39),
      ),
    ).toBe("data");

    // Data size = 200 bytes (100 samples * 2 bytes)
    expect(view.getUint32(40, true)).toBe(200);
  });

  it("preserves PCM sample values", async () => {
    const builder = new WavBuilder();
    // 10 samples at value 1000 (Int16)
    builder.addChunk(makeConstantChunk(10, 1000));

    const blob = builder.toBlob();
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);

    // PCM data starts at byte 44
    for (let i = 0; i < 10; i++) {
      expect(view.getInt16(44 + i * 2, true)).toBe(1000);
    }
  });

  it("handles multiple chunks in correct order", async () => {
    const builder = new WavBuilder();
    builder.addChunk(makeConstantChunk(5, 100));
    builder.addChunk(makeConstantChunk(5, 200));

    const blob = builder.toBlob();
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);

    // First 5 samples = 100
    for (let i = 0; i < 5; i++) {
      expect(view.getInt16(44 + i * 2, true)).toBe(100);
    }
    // Next 5 samples = 200
    for (let i = 5; i < 10; i++) {
      expect(view.getInt16(44 + i * 2, true)).toBe(200);
    }
  });

  it("reset clears all data", () => {
    const builder = new WavBuilder();
    builder.addChunk(makeSilentChunk(4000));
    expect(builder.hasData).toBe(true);

    builder.reset();
    expect(builder.hasData).toBe(false);
    expect(builder.getDurationMs()).toBe(0);
  });

  it("produces valid blob after reset and new data", () => {
    const builder = new WavBuilder();
    builder.addChunk(makeSilentChunk(4000));
    builder.reset();
    builder.addChunk(makeSilentChunk(2000));

    const blob = builder.toBlob();
    // 44 header + 4000 bytes (2000 samples * 2)
    expect(blob.size).toBe(44 + 4000);
  });
});
