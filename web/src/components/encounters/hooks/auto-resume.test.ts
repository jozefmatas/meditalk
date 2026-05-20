import { describe, it, expect } from "vitest";
import { decideResumeAction } from "./auto-resume";
import type { Encounter } from "@/lib/types";

// Build a minimal Encounter for the decision function. All other fields
// are irrelevant — the function only reads status + metadata.
function makeVisit(
  status: Encounter["status"],
  metadata: Partial<Encounter["metadata"]> = {},
): Encounter {
  return {
    id: "v1",
    status,
    metadata: metadata as Encounter["metadata"],
  } as Encounter;
}

describe("decideResumeAction", () => {
  it("returns 'no-op' when visit is already processing", () => {
    expect(decideResumeAction(makeVisit("processing"))).toBe("no-op");
  });

  it("returns 'reset' when there is no transcript, no audio, and no extracted files", () => {
    const visit = makeVisit("started", {
      generation_pending: {} as Encounter["metadata"]["generation_pending"],
    });
    expect(decideResumeAction(visit)).toBe("reset");
  });

  it("returns 'generate' when a transcript is available", () => {
    const visit = makeVisit("started", {
      transcript: "patient feels ill",
      generation_pending: {} as Encounter["metadata"]["generation_pending"],
    });
    expect(decideResumeAction(visit)).toBe("generate");
  });

  it("returns 'generate' when an extracted (non-recording) file is available", () => {
    const visit = makeVisit("started", {
      generation_pending: {} as Encounter["metadata"]["generation_pending"],
      files: [
        {
          id: "f1",
          extracted_text: "lab results",
          source: "upload",
        } as Encounter["metadata"]["files"][number],
      ],
    });
    expect(decideResumeAction(visit)).toBe("generate");
  });

  it("ignores extracted text on recording-source files (they're consumed differently)", () => {
    const visit = makeVisit("started", {
      generation_pending: {} as Encounter["metadata"]["generation_pending"],
      files: [
        {
          id: "f1",
          extracted_text: "ignored",
          source: "recording",
        } as Encounter["metadata"]["files"][number],
      ],
    });
    expect(decideResumeAction(visit)).toBe("reset");
  });

  it("returns 'generate' when audioPath is set on generation_pending", () => {
    const visit = makeVisit("started", {
      generation_pending: {
        audioPath: "audio/x.webm",
      } as Encounter["metadata"]["generation_pending"],
    });
    expect(decideResumeAction(visit)).toBe("generate");
  });

  it("returns 'generate' when audioPath is set on recording_session", () => {
    const visit = makeVisit("started", {
      generation_pending: {} as Encounter["metadata"]["generation_pending"],
      recording_session: {
        audioPath: "audio/x.webm",
      } as Encounter["metadata"]["recording_session"],
    });
    expect(decideResumeAction(visit)).toBe("generate");
  });
});
