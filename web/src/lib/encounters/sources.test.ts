import { describe, it, expect } from "vitest";
import { getTranscript, getDoctorNotes, getFileTexts } from "./sources";
import type { FileMetadata } from "@/lib/types";

describe("getTranscript", () => {
  it("returns null for null metadata", () => {
    expect(getTranscript(null)).toBeNull();
  });

  it("returns null for undefined metadata", () => {
    expect(getTranscript(undefined)).toBeNull();
  });

  it("returns null for empty metadata", () => {
    expect(getTranscript({})).toBeNull();
  });

  it("returns null for empty string transcript", () => {
    expect(getTranscript({ transcript: "" })).toBeNull();
  });

  it("returns null for non-string transcript", () => {
    expect(getTranscript({ transcript: 42 })).toBeNull();
  });

  it("returns the transcript text", () => {
    expect(getTranscript({ transcript: "Patient reports headache" })).toBe(
      "Patient reports headache",
    );
  });
});

describe("getDoctorNotes", () => {
  it("returns null for null metadata", () => {
    expect(getDoctorNotes(null)).toBeNull();
  });

  it("returns null for undefined metadata", () => {
    expect(getDoctorNotes(undefined)).toBeNull();
  });

  it("returns null for empty metadata", () => {
    expect(getDoctorNotes({})).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(getDoctorNotes({ doctor_notes: "" })).toBeNull();
  });

  it("returns the doctor notes", () => {
    expect(getDoctorNotes({ doctor_notes: "Check blood pressure" })).toBe(
      "Check blood pressure",
    );
  });
});

describe("getFileTexts", () => {
  it("returns empty array for empty files", () => {
    expect(getFileTexts([])).toEqual([]);
  });

  it("filters out files without extracted_text", () => {
    const files: FileMetadata[] = [
      {
        id: "1",
        name: "doc.pdf",
        size: 100,
        type: "application/pdf",
        extracted_text: null,
      },
    ];
    expect(getFileTexts(files)).toEqual([]);
  });

  it("excludes recording files", () => {
    const files: FileMetadata[] = [
      {
        id: "1",
        name: "recording.webm",
        size: 5000,
        type: "audio/webm",
        source: "recording",
        extracted_text: "transcript text",
      },
    ];
    expect(getFileTexts(files)).toEqual([]);
  });

  it("returns uploaded files with extracted text", () => {
    const files: FileMetadata[] = [
      {
        id: "1",
        name: "labs.pdf",
        size: 200,
        type: "application/pdf",
        source: "upload",
        extracted_text: "WBC 12.5",
      },
      {
        id: "2",
        name: "scan.jpg",
        size: 300,
        type: "image/jpeg",
        source: "upload",
        extracted_text: "CT scan showing...",
      },
    ];
    expect(getFileTexts(files)).toEqual([
      { name: "labs.pdf", type: "application/pdf", text: "WBC 12.5" },
      { name: "scan.jpg", type: "image/jpeg", text: "CT scan showing..." },
    ]);
  });

  it("handles mix of files with and without extracted text", () => {
    const files: FileMetadata[] = [
      {
        id: "1",
        name: "labs.pdf",
        size: 200,
        type: "application/pdf",
        extracted_text: "WBC 12.5",
      },
      {
        id: "2",
        name: "pending.pdf",
        size: 300,
        type: "application/pdf",
        extracted_text: null,
        extraction_status: "pending",
      },
      {
        id: "3",
        name: "recording.webm",
        size: 5000,
        type: "audio/webm",
        source: "recording",
        extracted_text: "should be excluded",
      },
    ];
    expect(getFileTexts(files)).toEqual([
      { name: "labs.pdf", type: "application/pdf", text: "WBC 12.5" },
    ]);
  });
});
