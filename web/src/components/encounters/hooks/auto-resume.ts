import type { Encounter } from "@/lib/types";
import { getTranscript } from "@/lib/encounters/sources";

/**
 * Outcome of the auto-resume check for an interrupted generation.
 *
 *  - `no-op`     The visit is already mid-generation server-side
 *                (status: "processing"). Streaming hook restores from
 *                cache; nothing to do here.
 *  - `reset`     No source material is available (no transcript, no
 *                extracted upload, no audio). Clear `generation_pending`
 *                and put the visit back to "started" so the doctor can
 *                re-record / re-upload.
 *  - `generate`  At least one source exists. Re-run the generation
 *                pipeline.
 */
export type ResumeAction = "no-op" | "reset" | "generate";

/** Pure decision: given the visit, what should auto-resume do? */
export function decideResumeAction(visit: Encounter): ResumeAction {
  if (visit.status === "processing") return "no-op";

  const meta = visit.metadata;
  const pending = meta?.generation_pending;
  const session = meta?.recording_session;
  const hasTranscript = !!getTranscript(meta ?? null);
  const hasExtractedFiles = (meta?.files ?? []).some(
    (f) => f.extracted_text && f.source !== "recording",
  );

  if (
    !hasTranscript &&
    !hasExtractedFiles &&
    !pending?.audioPath &&
    !session?.audioPath
  ) {
    return "reset";
  }
  return "generate";
}
