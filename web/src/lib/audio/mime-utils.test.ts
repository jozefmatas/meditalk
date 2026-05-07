import { describe, it, expect } from "vitest";
import { audioMimeToExt } from "./mime-utils";

describe("audioMimeToExt", () => {
  it("returns .m4a for audio/mp4", () => {
    expect(audioMimeToExt("audio/mp4")).toBe(".m4a");
  });

  it("returns .ogg for audio/ogg", () => {
    expect(audioMimeToExt("audio/ogg")).toBe(".ogg");
  });

  it("returns .wav for audio/wav", () => {
    expect(audioMimeToExt("audio/wav")).toBe(".wav");
  });

  it("returns .webm for audio/webm", () => {
    expect(audioMimeToExt("audio/webm")).toBe(".webm");
  });

  it("returns .webm as default for unknown MIME", () => {
    expect(audioMimeToExt("audio/unknown")).toBe(".webm");
    expect(audioMimeToExt("")).toBe(".webm");
  });
});
