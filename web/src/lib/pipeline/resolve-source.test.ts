// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveSource } from "./resolve-source";

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock("@/lib/elevenlabs", () => ({
  transcribeAudio: vi.fn(),
}));

vi.mock("@/lib/extraction/extract-file", () => ({
  extractFileText: vi.fn(),
}));

const emptyAudit = {
  totalRedactions: 0,
  counts: {
    name: 0,
    birthNumber: 0,
    phone: 0,
    email: 0,
    address: 0,
    numericId: 0,
  },
};

vi.mock("@/lib/phi-scrubber", () => ({
  scrubPhi: vi.fn((text: string) => ({
    scrubbed: text,
    audit: emptyAudit,
  })),
}));

vi.mock("@/lib/supabase/merge-metadata", () => ({
  mergeVisitMetadata: vi.fn(),
}));

vi.mock("@/lib/encounters/sources", () => ({
  getTranscript: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { transcribeAudio } from "@/lib/elevenlabs";
import { scrubPhi } from "@/lib/phi-scrubber";
import { getTranscript } from "@/lib/encounters/sources";

const mockTranscribe = vi.mocked(transcribeAudio);
const mockScrub = vi.mocked(scrubPhi);
const mockGetTranscript = vi.mocked(getTranscript);

// ── Supabase mock builder ─────────────────────────────────────────

function createMockSupabase(opts?: {
  downloadResult?: { data: Blob | null; error: unknown };
  selectResult?: { data: { metadata: Record<string, unknown> } | null };
}) {
  const download = vi
    .fn()
    .mockResolvedValue(
      opts?.downloadResult ?? { data: null, error: new Error("not found") },
    );
  const select = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      single: vi
        .fn()
        .mockResolvedValue(opts?.selectResult ?? { data: { metadata: {} } }),
    }),
  });
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

  return {
    from: vi.fn().mockReturnValue({ select }),
    storage: { from: vi.fn().mockReturnValue({ download }) },
    rpc,
    _download: download,
    _select: select,
    _rpc: rpc,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockScrub.mockImplementation((text: string) => ({
    scrubbed: text,
    audit: { ...emptyAudit },
  }));
});

// ── Tests ─────────────────────────────────────────────────────────

describe("resolveSource", () => {
  it("builds rawSource from client transcriptText", async () => {
    const supabase = createMockSupabase();
    const result = await resolveSource({
      supabase: supabase as never,
      userId: "user-1",
      visitId: "visit-1",
      language: "sk",
      transcriptText: "Patient has headache",
      visit: { metadata: {}, patient_name: null, patient_id: null },
    });

    expect(result.rawSource.transcript).toBe("Patient has headache");
    expect(result.transcriptText).toBe("Patient has headache");
  });

  it("falls back to metadata transcript when transcriptText is empty", async () => {
    mockGetTranscript.mockReturnValue("Stored transcript from metadata");
    const supabase = createMockSupabase();

    const result = await resolveSource({
      supabase: supabase as never,
      userId: "user-1",
      visitId: "visit-1",
      language: "sk",
      visit: { metadata: {}, patient_name: null, patient_id: null },
    });

    expect(result.rawSource.transcript).toBe("Stored transcript from metadata");
  });

  it("applies PHI scrubbing and counts redactions", async () => {
    mockScrub.mockImplementation((text: string) => ({
      scrubbed: text.replace(/John/g, "[REDACTED]"),
      audit: { ...emptyAudit, totalRedactions: 1 },
    }));
    const supabase = createMockSupabase();

    const result = await resolveSource({
      supabase: supabase as never,
      userId: "user-1",
      visitId: "visit-1",
      language: "sk",
      transcriptText: "John has fever",
      doctorNotes: "John is 45",
      visit: {
        metadata: {},
        patient_name: "John",
        patient_id: null,
      },
    });

    expect(result.phiRedactionCount).toBe(2);
    expect(result.transcriptText).toBe("[REDACTED] has fever");
    expect(result.doctorNotes).toBe("[REDACTED] is 45");
  });

  it("skips audio recovery when client already sent transcriptText and no audioPath", async () => {
    const supabase = createMockSupabase();

    await resolveSource({
      supabase: supabase as never,
      userId: "user-1",
      visitId: "visit-1",
      language: "sk",
      transcriptText: "Client transcript",
      visit: {
        metadata: {
          generation_pending: { audioPath: "audio/blob.webm" },
        },
        patient_name: null,
        patient_id: null,
      },
    });

    // Should NOT call storage download since client sent transcript
    expect(mockTranscribe).not.toHaveBeenCalled();
  });

  it("enters audio recovery when audioPath is explicitly set", async () => {
    const audioBlob = new Blob(["audio data"]);
    const supabase = createMockSupabase({
      downloadResult: { data: audioBlob, error: null },
    });
    mockTranscribe.mockResolvedValue("Recovered transcript");

    const result = await resolveSource({
      supabase: supabase as never,
      userId: "user-1",
      visitId: "visit-1",
      language: "sk",
      audioPath: "audio/recovery.webm",
      visit: { metadata: {}, patient_name: null, patient_id: null },
    });

    expect(mockTranscribe).toHaveBeenCalled();
    expect(result.rawSource.transcript).toBe("Recovered transcript");
  });

  it("prepends recovered transcript to existing transcriptText", async () => {
    const audioBlob = new Blob(["audio data"]);
    const supabase = createMockSupabase({
      downloadResult: { data: audioBlob, error: null },
    });
    mockTranscribe.mockResolvedValue("Prior recording");

    const result = await resolveSource({
      supabase: supabase as never,
      userId: "user-1",
      visitId: "visit-1",
      language: "sk",
      transcriptText: "New recording",
      audioPath: "audio/recovery.webm",
      visit: { metadata: {}, patient_name: null, patient_id: null },
    });

    expect(result.rawSource.transcript).toBe(
      "Prior recording\n\nNew recording",
    );
  });

  it("excludes recording files from fileTexts when transcriptText is present", async () => {
    const supabase = createMockSupabase();
    const files = [
      {
        id: "f1",
        name: "recording.webm",
        size: 100,
        type: "audio/webm",
        source: "recording",
        extracted_text: "Recording transcript",
      },
      {
        id: "f2",
        name: "discharge.pdf",
        size: 200,
        type: "application/pdf",
        extracted_text: "Discharge letter text",
      },
    ];

    const result = await resolveSource({
      supabase: supabase as never,
      userId: "user-1",
      visitId: "visit-1",
      language: "sk",
      transcriptText: "Client transcript",
      visit: {
        metadata: { files },
        patient_name: null,
        patient_id: null,
      },
    });

    expect(result.fileTexts).toHaveLength(1);
    expect(result.fileTexts[0].name).toBe("discharge.pdf");
  });

  it("includes recording files when transcriptText is absent", async () => {
    mockGetTranscript.mockReturnValue(null);
    const supabase = createMockSupabase();
    const files = [
      {
        id: "f1",
        name: "recording.webm",
        size: 100,
        type: "audio/webm",
        source: "recording",
        extracted_text: "Recording transcript",
      },
    ];

    const result = await resolveSource({
      supabase: supabase as never,
      userId: "user-1",
      visitId: "visit-1",
      language: "sk",
      visit: {
        metadata: { files },
        patient_name: null,
        patient_id: null,
      },
    });

    expect(result.fileTexts).toHaveLength(1);
    expect(result.fileTexts[0].name).toBe("recording.webm");
  });
});
