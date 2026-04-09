import { describe, it, expect } from "vitest";
import {
  isFileUploading,
  hasUploadingFiles,
  type EncounterFile,
} from "./files-panel";

function makeFile(overrides: Partial<EncounterFile> = {}): EncounterFile {
  return {
    id: "f1",
    name: "test.pdf",
    size: 1024,
    type: "application/pdf",
    ...overrides,
  };
}

describe("isFileUploading", () => {
  it("returns true for a pending regular upload", () => {
    expect(isFileUploading(makeFile({ pending: true }))).toBe(true);
  });

  it("returns true for a pending recording-upload (audio uploaded during recording)", () => {
    expect(
      isFileUploading(makeFile({ pending: true, source: "recording-upload" })),
    ).toBe(true);
  });

  it("returns false for a completed upload", () => {
    expect(isFileUploading(makeFile({ pending: false }))).toBe(false);
  });

  it("returns false when pending is undefined", () => {
    expect(isFileUploading(makeFile())).toBe(false);
  });

  it("returns false for an active recording file (source === 'recording')", () => {
    // The live recording file is shown with a spinner in the UI, but generation
    // is explicitly allowed during recording, so it must not block the button.
    expect(
      isFileUploading(
        makeFile({ pending: true, source: "recording", isRecording: true }),
      ),
    ).toBe(false);
  });

  it("returns false for a paused recording file (source === 'recording', isRecording false)", () => {
    expect(
      isFileUploading(
        makeFile({ pending: true, source: "recording", isRecording: false }),
      ),
    ).toBe(false);
  });
});

describe("hasUploadingFiles", () => {
  it("returns false for an empty list", () => {
    expect(hasUploadingFiles([])).toBe(false);
  });

  it("returns false when no files are pending", () => {
    expect(
      hasUploadingFiles([
        makeFile({ id: "a", pending: false }),
        makeFile({ id: "b" }),
      ]),
    ).toBe(false);
  });

  it("returns true when at least one regular file is uploading", () => {
    expect(
      hasUploadingFiles([
        makeFile({ id: "a", pending: false }),
        makeFile({ id: "b", pending: true }),
      ]),
    ).toBe(true);
  });

  it("returns true when an audio-during-recording upload is still pending", () => {
    expect(
      hasUploadingFiles([
        makeFile({
          id: "a",
          pending: true,
          source: "recording-upload",
          type: "audio/mpeg",
        }),
      ]),
    ).toBe(true);
  });

  it("ignores the live recording file and returns false", () => {
    // The live recording file has source "recording" — the user is expected
    // to be able to press Generate while recording is active.
    expect(
      hasUploadingFiles([
        makeFile({
          id: "rec",
          pending: true,
          source: "recording",
          isRecording: true,
          type: "audio/webm",
        }),
      ]),
    ).toBe(false);
  });

  it("returns true when one real upload is mixed with a live recording", () => {
    expect(
      hasUploadingFiles([
        makeFile({
          id: "rec",
          pending: true,
          source: "recording",
          isRecording: true,
        }),
        makeFile({ id: "pdf", pending: true }),
      ]),
    ).toBe(true);
  });
});
