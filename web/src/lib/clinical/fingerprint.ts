/**
 * Generation input fingerprinting.
 *
 * Produces a stable, content-addressed fingerprint of every input that the
 * Pass 2 generator sees. Purpose: when two runs of the same visit produce
 * clinically different notes, comparing the fingerprints instantly tells us
 * whether the divergence is upstream (different inputs on the two runs)
 * or downstream (same inputs, LLM sampling variance).
 *
 * Each logical component gets its own SHA-256; a composite hash of the
 * components is used as the visit-level identifier. This lets us diff two
 * fingerprints and immediately see which stage changed.
 *
 * IMPORTANT: this module must be deterministic. No `Date.now()`, no `Math.random()`,
 * no iteration-order-dependent serialization. Object keys are always sorted.
 */
import { createHash } from "crypto";
import type { ClinicalAnalysis } from "./types";
import type { ExtractedFacts } from "./fact-extraction";

/** Component-level hashes for a single generation run. */
export interface GenerationFingerprint {
  /** SHA-256 of the full ordered transcript input (chunks joined). */
  transcriptHash: string;
  /** SHA-256 of the doctor notes text (empty string if none). */
  doctorNotesHash: string;
  /** SHA-256 of the combined file-extracted text (order-sensitive). */
  filesHash: string;
  /** SHA-256 of the Pass 1 clinical analysis JSON. */
  clinicalAnalysisHash: string;
  /** SHA-256 of the Pass 1.5 validated fact set JSON. */
  factsHash: string;
  /** SHA-256 of the final Pass 2 system prompt. */
  systemPromptHash: string;
  /** SHA-256 of the final Pass 2 user message. */
  userMessageHash: string;
  /** Composite SHA-256 over all the component hashes above (the "visit fingerprint"). */
  composite: string;
  /** Which template ID was used — included so template swaps don't silently pass. */
  templateId: string;
  /** Language of the generation run. */
  language: string;
  /** Optional counts for quick human inspection (do not use for equality). */
  counts: {
    transcriptChars: number;
    doctorNotesChars: number;
    fileCount: number;
    filesTotalChars: number;
    factCount: number;
  };
}

/** Components used to compute a fingerprint. */
export interface FingerprintInput {
  templateId: string;
  language: string;
  /** Transcript chunks in the exact order they are passed to the generator. */
  transcriptChunks: string[];
  /** Free-form doctor notes (undefined/null/"" all collapse to empty string). */
  doctorNotes?: string | null;
  /** Files with extracted text, in the order passed to the generator. */
  files: ReadonlyArray<{ name: string; type: string; text: string }>;
  /** Pass 1 clinical analysis output (null if skipped). */
  clinicalAnalysis: ClinicalAnalysis | null;
  /** Pass 1.5 validated facts (may be empty). */
  facts: ExtractedFacts;
  /** Final Pass 2 system prompt (exactly as sent to the model). */
  systemPrompt: string;
  /** Final Pass 2 user message (exactly as sent to the model). */
  userMessage: string;
}

/** SHA-256 of a UTF-8 string, returned as lowercase hex. */
export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Stable JSON stringify — sorts object keys at every depth. Used so that
 * two objects with the same content but different key insertion order hash
 * to the same value. Arrays keep their order (that's semantically meaningful).
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`,
  );
  return `{${parts.join(",")}}`;
}

/**
 * Strip the `usage` field from clinical analysis / facts before hashing.
 * Token counts are not part of the logical input — they are a side effect
 * of the call and will drift between runs. Hashing them would defeat the
 * whole point of a content fingerprint.
 */
function stripUsage<T extends { usage?: unknown }>(v: T): Omit<T, "usage"> {
  const copy = { ...v };
  delete (copy as { usage?: unknown }).usage;
  return copy;
}

/** Compute a full generation fingerprint from all its input pieces. */
export function computeFingerprint(
  input: FingerprintInput,
): GenerationFingerprint {
  const transcriptJoined = input.transcriptChunks.join("\n---CHUNK---\n");
  const doctorNotesText = input.doctorNotes?.trim() ?? "";

  // Files: order-sensitive join with explicit name/type headers so a file
  // reorder or rename changes the hash.
  const filesJoined = input.files
    .map((f) => `### ${f.name} (${f.type})\n${f.text}`)
    .join("\n---FILE---\n");

  const clinicalAnalysisJson = input.clinicalAnalysis
    ? stableStringify(stripUsage(input.clinicalAnalysis))
    : "null";
  const factsJson = stableStringify(stripUsage(input.facts));

  const transcriptHash = sha256(transcriptJoined);
  const doctorNotesHash = sha256(doctorNotesText);
  const filesHash = sha256(filesJoined);
  const clinicalAnalysisHash = sha256(clinicalAnalysisJson);
  const factsHash = sha256(factsJson);
  const systemPromptHash = sha256(input.systemPrompt);
  const userMessageHash = sha256(input.userMessage);

  // Composite: hash of the component hashes plus template/language. Any
  // change in any upstream piece bubbles up to this one value.
  const composite = sha256(
    stableStringify({
      templateId: input.templateId,
      language: input.language,
      transcriptHash,
      doctorNotesHash,
      filesHash,
      clinicalAnalysisHash,
      factsHash,
      systemPromptHash,
      userMessageHash,
    }),
  );

  const filesTotalChars = input.files.reduce(
    (sum, f) => sum + (f.text?.length ?? 0),
    0,
  );

  return {
    transcriptHash,
    doctorNotesHash,
    filesHash,
    clinicalAnalysisHash,
    factsHash,
    systemPromptHash,
    userMessageHash,
    composite,
    templateId: input.templateId,
    language: input.language,
    counts: {
      transcriptChars: transcriptJoined.length,
      doctorNotesChars: doctorNotesText.length,
      fileCount: input.files.length,
      filesTotalChars,
      factCount: countFactsForFingerprint(input.facts),
    },
  };
}

/** Small helper — kept private so we don't depend on `fact-validator.countFacts`. */
function countFactsForFingerprint(facts: ExtractedFacts): number {
  let total = 0;
  for (const key of Object.keys(facts) as Array<keyof ExtractedFacts>) {
    if (key === "usage") continue;
    const arr = facts[key];
    if (Array.isArray(arr)) total += arr.length;
  }
  return total;
}

/** Which component hashes differ between two fingerprints. */
export interface FingerprintDiff {
  /** True if the composite hashes are identical. */
  equal: boolean;
  /** Names of the components that differ (empty if `equal`). */
  changedComponents: Array<
    | "templateId"
    | "language"
    | "transcriptHash"
    | "doctorNotesHash"
    | "filesHash"
    | "clinicalAnalysisHash"
    | "factsHash"
    | "systemPromptHash"
    | "userMessageHash"
  >;
}

/**
 * Diff two fingerprints. Use this when investigating divergent outputs on
 * the same visit: if `equal` is true, the inputs were identical and the
 * divergence is pure LLM sampling variance. If `changedComponents` is
 * non-empty, the divergence is an upstream bug in whichever stage is listed.
 */
export function diffFingerprints(
  a: GenerationFingerprint,
  b: GenerationFingerprint,
): FingerprintDiff {
  const changed: FingerprintDiff["changedComponents"] = [];
  if (a.templateId !== b.templateId) changed.push("templateId");
  if (a.language !== b.language) changed.push("language");
  if (a.transcriptHash !== b.transcriptHash) changed.push("transcriptHash");
  if (a.doctorNotesHash !== b.doctorNotesHash) changed.push("doctorNotesHash");
  if (a.filesHash !== b.filesHash) changed.push("filesHash");
  if (a.clinicalAnalysisHash !== b.clinicalAnalysisHash)
    changed.push("clinicalAnalysisHash");
  if (a.factsHash !== b.factsHash) changed.push("factsHash");
  if (a.systemPromptHash !== b.systemPromptHash)
    changed.push("systemPromptHash");
  if (a.userMessageHash !== b.userMessageHash) changed.push("userMessageHash");
  return { equal: a.composite === b.composite, changedComponents: changed };
}
