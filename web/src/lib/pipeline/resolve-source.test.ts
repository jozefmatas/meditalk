// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveSource, waitForTranscript } from "./resolve-source";

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

/**
 * Mock supabase that returns different metadata on successive select() calls.
 * Used for testing polling behavior (waitForTranscript, waitForExtractions).
 */
function createPollingMockSupabase(
  metadataSequence: Record<string, unknown>[],
  opts?: {
    downloadResult?: { data: Blob | null; error: unknown };
  },
) {
  let callIndex = 0;
  const single = vi.fn().mockImplementation(() => {
    const idx = Math.min(callIndex++, metadataSequence.length - 1);
    return Promise.resolve({
      data: { metadata: metadataSequence[idx] },
    });
  });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  const download = vi
    .fn()
    .mockResolvedValue(
      opts?.downloadResult ?? { data: null, error: new Error("not found") },
    );
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

  return {
    from: vi.fn().mockReturnValue({ select }),
    storage: { from: vi.fn().mockReturnValue({ download }) },
    rpc,
    _single: single,
    _download: download,
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

  it("enters audio recovery when audioPath is set and no transcriptText", async () => {
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

  it("skips audio recovery when both transcriptText and audioPath are provided", async () => {
    const supabase = createMockSupabase();

    const result = await resolveSource({
      supabase: supabase as never,
      userId: "user-1",
      visitId: "visit-1",
      language: "sk",
      transcriptText: "Pause transcript covers full recording",
      audioPath: "audio/recovery.webm",
      visit: { metadata: {}, patient_name: null, patient_id: null },
    });

    // Should NOT download or transcribe — pause transcript is sufficient
    expect(mockTranscribe).not.toHaveBeenCalled();
    expect(result.rawSource.transcript).toBe(
      "Pause transcript covers full recording",
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

  it("skips transcript polling and enters audio recovery when no snapshotVersion", async () => {
    const audioBlob = new Blob(["audio data"]);
    const supabase = createMockSupabase({
      downloadResult: { data: audioBlob, error: null },
    });
    mockTranscribe.mockResolvedValue("Recovered from audio");

    const result = await resolveSource({
      supabase: supabase as never,
      userId: "user-1",
      visitId: "visit-1",
      language: "sk",
      audioPath: "audio/rec.webm",
      visit: {
        metadata: {
          // No recording_session — no snapshotVersion to poll for
        },
        patient_name: null,
        patient_id: null,
      },
    });

    // Should have gone straight to audio recovery (no polling)
    expect(mockTranscribe).toHaveBeenCalled();
    expect(result.rawSource.transcript).toBe("Recovered from audio");
  });

  it("falls back to audio recovery when transcript polling times out", async () => {
    vi.useFakeTimers();
    try {
      const audioBlob = new Blob(["audio data"]);
      const supabase = createPollingMockSupabase(
        [
          // Polling always returns metadata without matching transcript
          {
            recording_session: {
              snapshotVersion: 200,
              audioPath: "audio/rec.webm",
            },
          },
        ],
        { downloadResult: { data: audioBlob, error: null } },
      );
      mockTranscribe.mockResolvedValue("Fallback transcript");

      const promise = resolveSource({
        supabase: supabase as never,
        userId: "user-1",
        visitId: "visit-1",
        language: "sk",
        audioPath: "audio/rec.webm",
        visit: {
          metadata: {
            recording_session: {
              state: "paused",
              durationAtPause: 0,
              snapshotVersion: 200,
              audioPath: "audio/rec.webm",
            },
          },
          patient_name: null,
          patient_id: null,
        },
      });

      // Advance past transcript polling timeout + audio recovery retries
      await vi.advanceTimersByTimeAsync(60_000);
      const result = await promise;

      // Polling timed out → fell back to audio recovery
      expect(mockTranscribe).toHaveBeenCalled();
      expect(result.rawSource.transcript).toBe("Fallback transcript");
    } finally {
      vi.useRealTimers();
    }
  });

  it("polls for transcript and skips audio recovery when snapshotVersion exists", async () => {
    const supabase = createPollingMockSupabase([
      // 1st call (waitForTranscript initial check): not ready
      {
        recording_session: {
          snapshotVersion: 100,
          audioPath: "audio/rec.webm",
        },
      },
      // 2nd call (waitForTranscript poll): transcript arrives
      {
        recording_session: {
          snapshotVersion: 100,
          audioPath: "audio/rec.webm",
        },
        transcript: "Polled transcript",
        transcriptSnapshotVersion: 100,
      },
      // 3rd call (final metadata re-read at end of resolveSource)
      {
        recording_session: {
          snapshotVersion: 100,
          audioPath: "audio/rec.webm",
        },
        transcript: "Polled transcript",
        transcriptSnapshotVersion: 100,
      },
    ]);

    const result = await resolveSource({
      supabase: supabase as never,
      userId: "user-1",
      visitId: "visit-1",
      language: "sk",
      audioPath: "audio/rec.webm",
      visit: {
        metadata: {
          recording_session: {
            state: "paused",
            durationAtPause: 0,
            snapshotVersion: 100,
            audioPath: "audio/rec.webm",
          },
        },
        patient_name: null,
        patient_id: null,
      },
    });

    expect(result.rawSource.transcript).toBe("Polled transcript");
    // Should NOT call transcribeAudio — polling found the transcript
    expect(mockTranscribe).not.toHaveBeenCalled();
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

// ── waitForTranscript ────────────────────────────────────────────

describe("waitForTranscript", () => {
  it("returns transcript immediately when versions match", async () => {
    const supabase = createMockSupabase({
      selectResult: {
        data: {
          metadata: {
            transcript: "Already transcribed",
            transcriptSnapshotVersion: 42,
          },
        },
      },
    });

    const result = await waitForTranscript(supabase as never, "visit-1", 42);

    expect(result.transcript).toBe("Already transcribed");
    expect(result.polled).toBe(false);
  });

  it("polls and returns transcript when it arrives", async () => {
    const supabase = createPollingMockSupabase([
      // 1st call (initial check): transcript not ready
      {},
      // 2nd call (first poll): transcript arrives
      {
        transcript: "Arrived after poll",
        transcriptSnapshotVersion: 42,
      },
    ]);

    const result = await waitForTranscript(supabase as never, "visit-1", 42);

    expect(result.transcript).toBe("Arrived after poll");
    expect(result.polled).toBe(true);
  });

  it("returns undefined after timeout when transcript never arrives", async () => {
    vi.useFakeTimers();
    try {
      const supabase = createPollingMockSupabase([
        // Always returns metadata without matching transcript
        { transcript: "stale", transcriptSnapshotVersion: 10 },
      ]);

      const promise = waitForTranscript(supabase as never, "visit-1", 42);
      // Advance past the full timeout
      await vi.advanceTimersByTimeAsync(35_000);
      const result = await promise;

      expect(result.transcript).toBeUndefined();
      expect(result.polled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
