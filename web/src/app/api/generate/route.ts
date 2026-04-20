import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { retrySupabaseCall } from "@/lib/supabase/retry";
import { mergeVisitMetadata } from "@/lib/supabase/merge-metadata";
import { embedText, LEGACY_EMBEDDING_MODEL } from "@/lib/openai";
import {
  generateFromTemplate,
  InsufficientContextError,
} from "@/lib/anthropic";
import { extractFileText } from "@/lib/extraction/extract-file";
import { transcribeAudio } from "@/lib/elevenlabs";
import {
  DEFAULT_TEMPLATE_ID,
  buildSectionLabelsFromTemplate,
  buildSectionContextsFromTemplate,
} from "@/lib/templates";
import { resolveTemplate } from "@/lib/templates/server";
import { flattenSectionIds } from "@/lib/templates/html";
import {
  runFactExtraction,
  validateFacts,
  resolveFacts,
  resolveTimelineCoherence,
  resolveIcdFromFacts,
  countFacts,
  emptyExtractedFacts,
  computeFingerprint,
  filterCertainIcdCandidates,
  scrubPhi,
} from "@/lib/clinical";
import { logAudit, createAuditContext } from "@/lib/audit";
import { dispatchNoteEmail } from "@/lib/email/send-note-email";
import { createSSEStream, sseResponse } from "@/lib/api/sse";
import type { ClinicalAnalysis, CandidateIcdCode } from "@/lib/clinical/types";
import type {
  ExtractedFacts,
  FactExtractionInput,
} from "@/lib/clinical/fact-extraction";
import type { SupportedLanguage, FileMetadata } from "@/lib/types";
import { getTranscript } from "@/lib/encounters/sources";
import {
  EXTRACTION_STUCK_THRESHOLD_MS,
  EXTRACTION_WAIT_TIMEOUT_MS,
  EXTRACTION_POLL_INTERVAL_MS,
} from "@/lib/extraction/constants";
import { logger } from "@/lib/logger";

export const maxDuration = 800;

const RETRIEVAL_QUERY: Record<SupportedLanguage, string> = {
  en: "Patient symptoms, diagnosis, examination findings, treatment plan, medications, follow-up",
  sk: "Symptómy pacienta, diagnóza, vyšetrenie, plán liečby, lieky, kontrola",
  cs: "Symptomy pacienta, diagnóza, vyšetření, plán léčby, léky, kontrola",
};

export async function POST(request: NextRequest) {
  const t0 = Date.now();
  const lap = (label: string) =>
    logger.debug(`[generate] ${label} — ${Date.now() - t0}ms`);

  // Auth — return JSON errors for auth failures
  let userId: string;
  let supabase: Awaited<ReturnType<typeof requireAuth>>["supabase"];
  let authResult: Awaited<ReturnType<typeof requireAuth>>;

  try {
    authResult = await requireAuth();
    userId = authResult.userId;
    supabase = authResult.supabase;
    lap("auth");
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    // Support both visitId (new) and transcriptId (legacy)
    const visitId = body.visitId || body.transcriptId;
    const templateId: string | undefined = body.templateId;
    let doctorNotes: string | undefined = body.doctorNotes;
    // Scribe real-time transcript (used for recording files instead of Whisper)
    let transcriptText: string | undefined = body.transcriptText;
    // Recovery: path to stored audio blob in Supabase storage (uploaded at
    // generate time so the recording survives app kill/refresh).
    const audioPath: string | undefined = body.audioPath;
    const sendAsEmail: boolean = body.sendAsEmail === true;
    logger.debug("[generate] sendAsEmail:", sendAsEmail);

    logger.debug(
      `[generate] transcriptText: ${transcriptText ? `${transcriptText.length} chars` : "NONE"}`,
    );

    if (!visitId) {
      return NextResponse.json(
        { error: "Missing required field: visitId" },
        { status: 400 },
      );
    }

    logAudit({
      ...createAuditContext(authResult, request),
      action: "encounter.generate",
      resourceType: "encounter",
      resourceId: visitId,
      metadata: { templateId },
    });

    // Fetch the visit to get its language and existing metadata.
    // The transcript is stored in metadata.transcript (set during pause-time
    // transcription); used as fallback when client-side transcription fails.
    const { data: visit, error: visitError } = await supabase
      .from("visits")
      .select(
        "id, title, language, metadata, visit_date, patient_name, patient_id",
      )
      .eq("id", visitId)
      .single();

    if (visitError || !visit) {
      return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    }

    const language = (visit.language as SupportedLanguage) || "en";
    const visitDate: string | undefined =
      typeof visit.visit_date === "string" ? visit.visit_date : undefined;
    const patientName: string | undefined =
      typeof visit.patient_name === "string" ? visit.patient_name : undefined;
    const patientId: string | undefined =
      typeof visit.patient_id === "string" ? visit.patient_id : undefined;

    // Recovery / resume: if stored audio exists, download and transcribe.
    // When both audioPath and transcriptText are present (resume + generate:
    // prior recording in storage + new recording transcribed client-side),
    // prepend the prior recording's transcript to the new one.
    //
    // Resolve the effective audio path: prefer client-provided, fall back to
    // metadata paths (recording_session.audioPath, generation_pending.audioPath).
    // This ensures recovery works even when the client didn't pass the path
    // (e.g. stale JS bundle, race condition, or incomplete client-side state).
    const visitMeta = (visit.metadata ?? {}) as Record<string, unknown>;
    const sessionAudioPath = (
      visitMeta.recording_session as { audioPath?: string } | undefined
    )?.audioPath;
    const pendingAudioPath = (
      visitMeta.generation_pending as { audioPath?: string } | undefined
    )?.audioPath;
    const effectiveAudioPath =
      audioPath || pendingAudioPath || sessionAudioPath;

    // Only enter recovery when:
    // 1. The client explicitly asked for it (audioPath param set) — e.g.
    //    client transcription failed, or restored session prepend.
    // 2. OR there is no transcriptText yet — full recovery needed.
    //
    // When the client already sent transcriptText (successful client-side
    // transcription) AND did NOT pass audioPath, skip recovery — the
    // pendingAudioPath/sessionAudioPath in metadata is the SAME blob the
    // client already transcribed via batch-transcribe. Re-transcribing it
    // would double the transcript.
    if (effectiveAudioPath && (audioPath || !transcriptText)) {
      logger.debug(
        `[generate] Recovery audio — client: ${audioPath || "NONE"}, pending: ${pendingAudioPath || "NONE"}, session: ${sessionAudioPath || "NONE"} → using: ${effectiveAudioPath}`,
      );
      lap("recovery-download-start");
      const RECOVERY_MAX_RETRIES = 2; // 3 attempts total
      for (let attempt = 0; attempt <= RECOVERY_MAX_RETRIES; attempt++) {
        try {
          const { data: audioData, error: dlError } = await supabase.storage
            .from("encounter-files")
            .download(effectiveAudioPath);

          if (dlError || !audioData) {
            logger.error(
              `[generate] Failed to download recovery audio (attempt ${attempt + 1}/${RECOVERY_MAX_RETRIES + 1}):`,
              dlError,
            );
            if (attempt < RECOVERY_MAX_RETRIES) {
              await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
              continue;
            }
            break;
          }

          const buffer = Buffer.from(await audioData.arrayBuffer());
          logger.debug(
            `[generate] Recovery audio downloaded: ${buffer.byteLength} bytes`,
          );
          const ext = effectiveAudioPath.substring(
            effectiveAudioPath.lastIndexOf("."),
          );
          const recovered = await transcribeAudio(
            buffer,
            `recovery${ext}`,
            language,
            { userId, visitId },
          );
          if (recovered) {
            // Prepend prior recording transcript to new recording transcript
            transcriptText = transcriptText
              ? `${recovered}\n\n${transcriptText}`
              : recovered;
            logger.debug(
              `[generate] Recovery transcription: ${recovered.length} chars (total: ${transcriptText.length} chars)`,
            );
          } else {
            logger.warn(
              `[generate] Recovery transcription returned empty text (attempt ${attempt + 1}/${RECOVERY_MAX_RETRIES + 1})`,
            );
            if (attempt < RECOVERY_MAX_RETRIES) {
              await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
              continue;
            }
          }
          break; // Success or non-retryable
        } catch (err) {
          logger.warn(
            `[generate] Recovery audio transcription failed (attempt ${attempt + 1}/${RECOVERY_MAX_RETRIES + 1}):`,
            err,
          );
          if (attempt < RECOVERY_MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
            continue;
          }
          // Final attempt failed — fall through to other fallbacks
        }
      }
      lap("recovery-download-done");
    } else if (effectiveAudioPath && transcriptText && !audioPath) {
      logger.debug(
        `[generate] Skipping recovery audio — client already sent ${transcriptText.length} char transcript (metadata audioPath: ${effectiveAudioPath})`,
      );
    }

    // Fallback: if client-side transcription failed (transcriptText is empty)
    // but the visit has a transcript from pause-time transcription, use that.
    // This prevents losing the transcript when the generate-time batch
    // transcription fails (network error, timeout, etc.).
    if (!transcriptText) {
      const existingTranscript = getTranscript(visitMeta);
      if (existingTranscript) {
        transcriptText = existingTranscript;
        logger.debug(
          `[generate] Using metadata.transcript fallback: ${transcriptText.length} chars`,
        );
      }
    }
    let uploadedFiles = (visitMeta.files ?? []) as FileMetadata[];

    // ── Stuck extraction recovery ──────────────────────────────
    // If a file has been "extracting" longer than the threshold, the server
    // process that was extracting likely died. Reset to "failed" so it
    // enters the retry path below. Also clear extraction_started_at so
    // the next retry gets a fresh timestamp (otherwise stuck recovery
    // would trigger immediately on the retry because the old timestamp
    // is still > threshold).
    const now = Date.now();
    for (const file of uploadedFiles) {
      if (file.extraction_status !== "extracting") continue;
      if (!file.extraction_started_at) continue;
      const elapsed = now - new Date(file.extraction_started_at).getTime();
      if (elapsed > EXTRACTION_STUCK_THRESHOLD_MS) {
        logger.warn(
          `[generate] Resetting stuck extraction: file=${file.id} name=${file.name} elapsed=${Math.round(elapsed / 1000)}s`,
        );
        await supabase.rpc("update_file_extraction_status", {
          p_visit_id: visitId,
          p_file_id: file.id,
          p_status: "failed",
        });
        file.extraction_status = "failed";
        file.extraction_started_at = null;
      }
    }

    // ── Wait for in-progress extractions ─────────────────────
    // Poll until all pending/extracting files resolve (or timeout).
    const pendingIds = new Set(
      uploadedFiles
        .filter(
          (f) =>
            f.extraction_status === "extracting" ||
            f.extraction_status === "pending",
        )
        .map((f) => f.id),
    );

    if (pendingIds.size > 0) {
      logger.debug(
        `[generate] Waiting for ${pendingIds.size} extraction(s): ${uploadedFiles
          .filter((f) => pendingIds.has(f.id))
          .map((f) => f.name)
          .join(", ")}`,
      );
      const pollStart = Date.now();

      while (Date.now() - pollStart < EXTRACTION_WAIT_TIMEOUT_MS) {
        await new Promise((resolve) =>
          setTimeout(resolve, EXTRACTION_POLL_INTERVAL_MS),
        );
        const { data: refreshed } = await supabase
          .from("visits")
          .select("metadata")
          .eq("id", visitId)
          .single();
        if (!refreshed) break;

        const meta = (refreshed.metadata ?? {}) as Record<string, unknown>;
        uploadedFiles = (meta.files ?? []) as FileMetadata[];

        const stillPending = uploadedFiles.filter(
          (f) =>
            pendingIds.has(f.id) &&
            (f.extraction_status === "extracting" ||
              f.extraction_status === "pending"),
        );
        if (stillPending.length === 0) break;
      }

      const completed = uploadedFiles.filter(
        (f) => pendingIds.has(f.id) && f.extraction_status === "completed",
      ).length;
      const failed = uploadedFiles.filter(
        (f) => pendingIds.has(f.id) && f.extraction_status === "failed",
      ).length;
      logger.debug(
        `[generate] Extraction wait done (${Date.now() - pollStart}ms): ${completed} completed, ${failed} failed out of ${pendingIds.size}`,
      );
    }

    // ── Inline extraction for unprocessed files ────────────────
    // Files that are "failed" (retrying) or legacy (no status) get extracted
    // inline in parallel. Files still "extracting" or "pending" are skipped
    // (they're being handled by background extraction).
    const unprocessed = uploadedFiles.filter(
      (f) =>
        !f.extracted_text &&
        f.path &&
        f.extraction_status !== "extracting" &&
        f.extraction_status !== "pending",
    );
    const extractionErrors: string[] = [];

    if (unprocessed.length > 0) {
      const retrying = unprocessed.filter(
        (f) => f.extraction_status === "failed",
      );
      const legacy = unprocessed.filter((f) => !f.extraction_status);
      logger.debug(
        `[generate] Extracting ${unprocessed.length} file(s) inline: ${retrying.length} retrying, ${legacy.length} legacy`,
      );
      lap("extraction-start");

      await Promise.all(
        unprocessed.map(async (file) => {
          try {
            const result = await extractFileText({
              file: { ...file, path: file.path! },
              supabase,
              userId,
              visitId,
              language,
              // Audio files can use the real-time transcript as a shortcut
              ...(file.type.startsWith("audio/") && { transcriptText }),
            });
            file.extracted_text = result.text;
            logger.debug(
              `[generate] Extracted ${result.text.length} chars from ${file.name} in ${result.elapsedMs}ms`,
            );
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : "Unknown extraction error";
            logger.error(`[generate] Extraction failed for ${file.name}:`, err);
            extractionErrors.push(`${file.name}: ${msg}`);
          }
        }),
      );

      lap("extraction-done");

      // Persist recording transcript to metadata.transcript (for ResourcesPanel).
      // NOTE: Do NOT update metadata.files here — the extract route already saved
      // extracted_text and extraction_status atomically. Writing the files array
      // here would overwrite those atomic updates with stale data.
      const recordingText = uploadedFiles.find(
        (f) => f.source === "recording" && f.extracted_text,
      )?.extracted_text;
      if (recordingText) {
        await mergeVisitMetadata(supabase, visitId, {
          transcript: recordingText,
        });
      }
    }

    // When transcriptText is available it goes into transcriptChunks (line 527)
    // as a "Chunk" in the prompt. Exclude recording-sourced files from fileTexts
    // so the same transcript doesn't also appear as a "File" — this caused
    // double transcripts in generated sources on Android with pause/resume.
    const fileTexts = uploadedFiles
      .filter(
        (f) =>
          f.extracted_text && !(transcriptText && f.source === "recording"),
      )
      .map((f) => ({
        name: f.name,
        type: f.type,
        text: f.extracted_text!,
        context: f.context || undefined,
      }));

    // Persist transcript to metadata for ResourcesPanel display.
    // (No need to add to fileTexts — transcriptChunks already carries it.)
    if (transcriptText) {
      await mergeVisitMetadata(supabase, visitId, {
        transcript: transcriptText,
      });
    }

    // Pass 1.1 — PHI scrub: remove patient identifiers before any LLM call.
    // Operates in-place on transcriptText, fileTexts, and doctorNotes.
    // Always runs — birth numbers, phones, emails are pattern-matched
    // regardless of whether patient name/id are known from the DB.
    let phiRedactionCount = 0;
    if (transcriptText) {
      const r = scrubPhi(transcriptText, patientName, patientId);
      transcriptText = r.scrubbed;
      phiRedactionCount += r.audit.totalRedactions;
    }
    for (const ft of fileTexts) {
      const r = scrubPhi(ft.text, patientName, patientId);
      ft.text = r.scrubbed;
      phiRedactionCount += r.audit.totalRedactions;
    }
    if (doctorNotes) {
      const r = scrubPhi(doctorNotes, patientName, patientId);
      doctorNotes = r.scrubbed;
      phiRedactionCount += r.audit.totalRedactions;
    }
    if (phiRedactionCount > 0) {
      logger.info(
        `[generate] PHI scrub: ${phiRedactionCount} redaction(s) applied`,
      );
    }

    // Re-read visit metadata after file extraction to include cached extracted_text
    // (fixes bug where second metadata save would overwrite cached extractions)
    const { data: refreshedVisit } = await supabase
      .from("visits")
      .select("metadata")
      .eq("id", visitId)
      .single();
    const refreshedMetadata =
      (refreshedVisit?.metadata as Record<string, unknown>) || visitMeta;

    // Look up the template (DB with static fallback)
    const template = await resolveTemplate(templateId || DEFAULT_TEMPLATE_ID);

    // Build section labels and contexts directly from the template
    const allIds = flattenSectionIds(template);
    const sectionLabels = buildSectionLabelsFromTemplate(template, language);
    const sectionContexts = buildSectionContextsFromTemplate(template);

    // Semantic search on legacy transcript chunks + clinical analysis — run in parallel
    let chunkContents: string[] = [];
    let usedChunks: string[] = [];
    const hasFileContent = fileTexts.length > 0;

    // Build clinical input from all extracted text + doctor notes.
    // When transcriptText is available, include it so Pass 1 (Sonnet)
    // sees the full picture for specialty detection and ICD grounding.
    const clinicalInputParts: string[] = [];
    if (transcriptText) {
      clinicalInputParts.push(transcriptText);
    }
    for (const ft of fileTexts) {
      const directive = ft.context
        ? `\nDOCTOR'S DIRECTIVE FOR THIS FILE: ${ft.context}`
        : "";
      clinicalInputParts.push(`[File: ${ft.name}]${directive}\n${ft.text}`);
    }
    if (doctorNotes?.trim()) {
      clinicalInputParts.push(`[Doctor Notes]\n${doctorNotes}`);
    }

    // Run embedding search, clinical analysis, and (when possible) fact
    // extraction in parallel. When transcriptText is available the fact
    // extraction input is fully known up-front so Pass 1.5 can start
    // immediately without waiting for embedding results.
    // @deprecated transcript_chunks — new encounters store transcript in
    // metadata.transcript; this legacy path only fires for old encounters
    // created before the batch-only migration.
    lap("parallel-start");
    const embeddingPromise = transcriptText
      ? Promise.resolve({
          chunkContents: [] as string[],
          usedChunks: [] as string[],
        })
      : (async () => {
          const { count: chunkCount } = await supabase
            .from("transcript_chunks")
            .select("id", { count: "exact", head: true })
            .eq("visit_id", visitId);

          if (!chunkCount || chunkCount === 0) {
            return {
              chunkContents: [] as string[],
              usedChunks: [] as string[],
            };
          }

          const queryEmbedding = await embedText(
            RETRIEVAL_QUERY[language],
            { userId, visitId },
            LEGACY_EMBEDDING_MODEL,
          );

          const { data: matches, error: rpcError } = await supabase.rpc(
            "match_chunks",
            {
              query_embedding: JSON.stringify(queryEmbedding),
              match_count: 16,
              p_visit_id: visitId,
            },
          );

          if (rpcError) {
            logger.error("match_chunks RPC error:", rpcError);
            return {
              chunkContents: [] as string[],
              usedChunks: [] as string[],
            };
          }

          if (matches && matches.length > 0) {
            return {
              chunkContents: matches.map((m: { content: string }) => m.content),
              usedChunks: matches.map((m: { id: string }) => m.id as string),
            };
          }
          return { chunkContents: [] as string[], usedChunks: [] as string[] };
        })();

    // Pass 1 (Sonnet clinical analysis) was deleted from the critical
    // path. The deterministic diagnosis resolver + strict grounding
    // + EncounterModel bucketing own ICD selection now. Synthesize a
    // minimal `ClinicalAnalysis` so downstream code keeps its shape —
    // candidateIcdCodes starts empty; the resolver fills it from
    // validated facts a few lines below.
    const syntheticClinicalAnalysis: ClinicalAnalysis = {
      matchedConcepts: [],
      inferredSpecialty:
        (template.specialties?.[0] as ClinicalAnalysis["inferredSpecialty"]) ??
        "general_practice",
      problemClusters: [],
      candidateIcdCodes: [],
      mentionedMedications: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
    const clinicalPromise: Promise<ClinicalAnalysis | null> = Promise.resolve(
      syntheticClinicalAnalysis,
    );

    // When transcriptText is available, fact extraction input is known
    // up-front so Pass 1.5 (Haiku) can start in parallel with Pass 1
    // (Sonnet) — saves ~4-8s of wall time vs the sequential path.
    // For legacy chunk encounters, fact extraction runs after embedding.
    const earlyFactInput: FactExtractionInput | null = transcriptText
      ? {
          chunks: [transcriptText],
          doctorNotes: doctorNotes?.trim() ? doctorNotes : undefined,
          files: fileTexts.length > 0 ? fileTexts : undefined,
          visitDate,
        }
      : null;

    const factExtractionPromise: Promise<ExtractedFacts | null> = earlyFactInput
      ? runFactExtraction(earlyFactInput, language, { userId, visitId }).catch(
          (err) => {
            logger.warn(
              "[generate] Parallel fact extraction failed, will retry sequentially:",
              err,
            );
            return null;
          },
        )
      : Promise.resolve(null);

    const [embeddingResult, rawClinicalAnalysis, earlyRawFacts] =
      await Promise.all([
        embeddingPromise,
        clinicalPromise,
        factExtractionPromise,
      ]);
    let clinicalAnalysis: ClinicalAnalysis | null = rawClinicalAnalysis;

    lap("parallel-done");
    chunkContents = embeddingResult.chunkContents;
    usedChunks = embeddingResult.usedChunks;

    // Add chunk contents to clinical input (for generation, not re-analysis)
    if (chunkContents.length > 0) {
      clinicalInputParts.unshift(...chunkContents);
    }

    // Use transcriptText if available (real-time streaming), otherwise use chunk contents
    const transcriptChunks = transcriptText ? [transcriptText] : chunkContents;

    // Pass 1.5 — Structured fact extraction + deterministic validation.
    // For transcriptText encounters, raw facts were extracted in parallel
    // above (earlyRawFacts). For legacy chunk encounters, extraction runs
    // sequentially here. Failures are non-fatal: we fall back to an empty
    // fact set and proceed with the current pipeline.
    let validatedFacts: ExtractedFacts = emptyExtractedFacts();
    let factWarnings: string[] = [];
    let factRemovedCount = 0;
    let factResolutionDropCount = 0;
    const factExtractionInput: FactExtractionInput = earlyFactInput ?? {
      chunks: transcriptChunks,
      doctorNotes: doctorNotes?.trim() ? doctorNotes : undefined,
      files: fileTexts.length > 0 ? fileTexts : undefined,
      visitDate,
    };
    const hasAnyFactSource =
      factExtractionInput.chunks.length > 0 ||
      !!factExtractionInput.doctorNotes ||
      (factExtractionInput.files?.length ?? 0) > 0;
    if (hasAnyFactSource) {
      try {
        // Use early results if available, otherwise run extraction now
        const rawFacts =
          earlyRawFacts ??
          (await runFactExtraction(factExtractionInput, language, {
            userId,
            visitId,
          }));
        const validation = validateFacts(rawFacts, factExtractionInput, {
          pass1: clinicalAnalysis,
          locale: language,
        });
        // Pass 1.6 — deterministic fact resolution. Drops facts that were
        // contradicted by a self-correction phrase. Rule-based and
        // deterministic by design so it doesn't reintroduce the LLM
        // non-determinism we're fighting.
        const resolution = resolveFacts(
          validation.validFacts,
          factExtractionInput,
          language,
        );
        // Pass 1.6c — timeline coherence. Collapses same-subject symptom /
        // chiefComplaint facts when one carries a more precise temporal
        // anchor ("od 13:00" vs "od rána"). Scope is narrow — measurements,
        // findings, etc. are untouched so legitimate time-series survives.
        const timeline = resolveTimelineCoherence(resolution.resolvedFacts);
        validatedFacts = timeline.facts;
        factWarnings = [
          ...validation.warnings,
          ...timeline.conflicts.map(
            (c) =>
              `Timeline conflict: kept "${c.kept.value}" (${c.keptAnchor.kind}) over "${c.dropped.value}" (${c.droppedAnchor.kind})`,
          ),
        ];
        factRemovedCount = validation.counts.removed;
        factResolutionDropCount =
          resolution.counts.total + timeline.conflicts.length;
        logger.debug(
          `[generate] Fact extraction — ${validation.counts.total} valid, ${factRemovedCount} removed by validator, ${resolution.counts.total} dropped by resolver (${resolution.counts.correctionDrops} correction), ${timeline.conflicts.length} timeline-conflicts collapsed, ${factWarnings.length} warnings`,
        );
        lap("fact-extraction-done");
      } catch (err) {
        logger.warn(
          "[generate] Fact extraction failed, proceeding without fact contract:",
          err,
        );
      }
    }

    // Pass 1.65 — Deterministic diagnosis resolver.
    // Resolves ICD codes directly from validated diagnosis facts using a
    // curated synonym table + exact/fuzzy CSV description match. Each
    // code carries `factIds` (stable "${category}-${index}" refs) so the
    // evidence trail is explicit: no evidence → excluded.
    //
    // Merge strategy: resolver codes become the PRIMARY source because
    // they are deterministic across runs (same facts → same codes).
    // Sonnet's suggestions are folded in as supplementary — codes the
    // resolver missed still appear, and Pass 1.7 (below) enforces
    // lexical grounding against facts regardless of who proposed them.
    // This is the fix for "ICD inconsistency across runs" the doctor
    // has been seeing.
    if (clinicalAnalysis) {
      const resolverResult = resolveIcdFromFacts(validatedFacts, language);
      // Key by the dot-stripped upper-case code so "I21.3" and "I213"
      // don't produce two distinct entries — they refer to the same code.
      const codeKey = (c: CandidateIcdCode) =>
        c.code.replace(/\./g, "").toUpperCase();
      const category3 = (c: CandidateIcdCode) =>
        c.code.replace(/\./g, "").toUpperCase().substring(0, 3);

      // Categories where the resolver produced a SPECIFIC subcode
      // (I21.2 → category I21). Sonnet's guesses in these categories
      // are suppressed — the resolver's pick is fact-grounded, Sonnet's
      // extras are usually speculative (e.g. I21 parent + I21.0 + I21.9
      // alongside the real I21.2 from "STEMI laterálna stena").
      const resolverSpecificCategories = new Set<string>();
      for (const c of resolverResult.codes) {
        if (c.code.includes(".")) resolverSpecificCategories.add(category3(c));
      }

      // Strict diagnosis-fact grounding — any Sonnet code that didn't
      // come from the resolver must have at least 2 meaningful tokens
      // (≥4 chars) overlapping with a validated DIAGNOSIS fact.
      // Rationale: Sonnet infers diagnoses from context (NT-proBNP →
      // I50.9 heart failure; no mention of GERD → K21.9; "hyperurikémia"
      // → M10.x dna). That overreach passes our old Pass 1.7 grounding
      // because it matched any fact token. We now require the code's
      // description to lexically align with something the doctor
      // actually called out as a diagnosis.
      const diagnosisTokens = new Set<string>();
      const normalizeTokens = (s: string): string[] =>
        s
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((t) => t.length >= 4);
      for (const f of validatedFacts.diagnoses) {
        for (const t of normalizeTokens(f.value)) diagnosisTokens.add(t);
      }
      const resolverKeys = new Set(resolverResult.codes.map(codeKey));
      const isDiagnosisGrounded = (c: CandidateIcdCode): boolean => {
        if (resolverKeys.has(codeKey(c))) return true; // resolver-emitted, already grounded
        const descTokens = normalizeTokens(c.description);
        let overlap = 0;
        for (const t of descTokens) if (diagnosisTokens.has(t)) overlap++;
        return overlap >= 2;
      };

      const byKey = new Map<string, CandidateIcdCode>();
      for (const c of resolverResult.codes) byKey.set(codeKey(c), c);
      let suppressed = 0;
      let ungrounded = 0;
      for (const c of clinicalAnalysis.candidateIcdCodes) {
        const key = codeKey(c);
        if (byKey.has(key)) continue;
        if (resolverSpecificCategories.has(category3(c))) {
          suppressed++;
          continue;
        }
        if (!isDiagnosisGrounded(c)) {
          ungrounded++;
          continue;
        }
        byKey.set(key, c);
      }
      clinicalAnalysis = {
        ...clinicalAnalysis,
        candidateIcdCodes: Array.from(byKey.values()),
      };
      logger.debug(
        `[generate] ICD resolver — ${resolverResult.codes.length} deterministic, ${suppressed} Sonnet suppressed (same-category as specific resolver pick), ${ungrounded} Sonnet dropped (not diagnosis-grounded), ${resolverResult.unresolved.length} unresolved`,
      );
    }

    // Preserve the full Pass 1 candidate list BEFORE certainty filtering.
    // These are shown as suggestions in the ICD panel so the doctor can
    // pick codes that the certainty filter dropped.
    //
    // Dedup defensively by normalized code — Sonnet can emit the same
    // code twice with different descriptions, and the UI keys list
    // entries by `code.code` so duplicates crash React with a
    // "two children with the same key" warning.
    const allCandidateIcdCodesRaw = clinicalAnalysis?.candidateIcdCodes ?? [];
    const seenCodes = new Set<string>();
    const allCandidateIcdCodes: CandidateIcdCode[] = [];
    for (const c of allCandidateIcdCodesRaw) {
      const key = c.code.replace(/\./g, "").toUpperCase();
      if (seenCodes.has(key)) continue;
      seenCodes.add(key);
      allCandidateIcdCodes.push(c);
    }

    // Pass 1.7 — Diagnosis certainty filter. Drop any candidate ICD code
    // that isn't lexically grounded in the validated diagnosis/history facts.
    // This is the deterministic gate that eliminates run-to-run drift in
    // the final Záver: Opus only sees codes that survived this filter, and
    // the system prompt forbids it from inventing new ones.
    if (clinicalAnalysis && clinicalAnalysis.candidateIcdCodes.length > 0) {
      // Debug: log fact values per category so we can trace grounding decisions
      const factSummary: Record<string, string[]> = {};
      for (const cat of [
        "diagnoses",
        "chiefComplaint",
        "symptoms",
        "findings",
        "medications",
        "personalHistory",
        "plan",
      ] as const) {
        const facts = validatedFacts[cat];
        if (facts.length > 0) {
          factSummary[cat] = facts.map((f) => f.value);
        }
      }
      logger.debug(
        `[generate] ICD grounding facts:`,
        JSON.stringify(factSummary, null, 2),
      );

      const certainty = filterCertainIcdCandidates(
        clinicalAnalysis.candidateIcdCodes,
        validatedFacts,
      );
      logger.debug(
        `[generate] ICD certainty — kept ${certainty.counts.kept}/${certainty.counts.total}`,
        certainty.dropped.slice(0, 5),
      );
      // Assessment bucketing (primary/secondary/chronic/differential)
      // is now handled by the EncounterModel builder — no separate
      // classifyAssessment pass needed.
      clinicalAnalysis = {
        ...clinicalAnalysis,
        candidateIcdCodes: certainty.kept,
      };
    }

    if (
      transcriptChunks.length === 0 &&
      !doctorNotes?.trim() &&
      !hasFileContent
    ) {
      if (extractionErrors.length > 0) {
        logger.error(
          `[generate] File processing failed: ${extractionErrors.join("; ")}`,
        );
      }
      return NextResponse.json(
        { error: "insufficient_context" },
        { status: 422 },
      );
    }

    // Use two-pass generation (Haiku draft → Opus refinement)
    logger.debug(
      `[generate] Starting two-pass generation (${transcriptChunks.length} chunks, ${fileTexts.length} files)`,
    );

    // Use two-pass generation via generateFromTemplate
    lap("generation-start");

    const readable = createSSEStream(async ({ sendEvent, safeClose }) => {
      // Notify client that clinical analysis is complete
      if (clinicalAnalysis) {
        sendEvent({
          type: "analysis_complete",
          specialty: clinicalAnalysis.inferredSpecialty,
          icdCodeCount: clinicalAnalysis.candidateIcdCodes.length,
          conceptCount: clinicalAnalysis.matchedConcepts.length,
        });
      }

      // Phase 2 — notify client that fact extraction is complete
      const factCount = countFacts(validatedFacts);
      if (
        factCount > 0 ||
        factRemovedCount > 0 ||
        factResolutionDropCount > 0
      ) {
        sendEvent({
          type: "facts_extracted",
          factCount,
          removedCount: factRemovedCount,
          warningCount: factWarnings.length,
          resolvedCount: factResolutionDropCount,
        });
      }

      // Notify client that generation is starting
      sendEvent({
        type: "streaming_start",
        sectionIds: allIds,
        sectionLabels,
      });

      try {
        // Call generateFromTemplate with streaming section extraction
        const {
          generatedNote,
          suggestedTitle,
          extractedIcdCodes,
          systemPrompt,
          userMessage,
          sanityReport,
        } = await generateFromTemplate(
          transcriptChunks,
          template,
          language,
          sectionLabels,
          doctorNotes,
          fileTexts,
          { userId, visitId },
          clinicalAnalysis ?? undefined,
          sectionContexts,
          (id, title, content) => {
            sendEvent({ type: "section", id, title, content });
          },
          factCount > 0 ? validatedFacts : undefined,
          visitDate,
          patientName,
          patientId,
        );

        lap("generation-done");

        // Determinism audit — fingerprint every logical input to the
        // generator. Compare fingerprints across runs to tell upstream
        // divergence (inputs differ) from downstream variance (same inputs,
        // different LLM output). Appended to metadata.generation_history so
        // a visit keeps the history of all its generations.
        const fingerprint = computeFingerprint({
          templateId: template.id,
          language,
          transcriptChunks,
          doctorNotes,
          files: fileTexts,
          clinicalAnalysis,
          facts: validatedFacts,
          systemPrompt,
          userMessage,
        });
        logger.info(
          `[generate] fingerprint visit=${visitId} composite=${fingerprint.composite}`,
        );

        // Override the Pass-1 Haiku candidate ICD list with the codes that
        // actually appear in the generated report. This keeps the sidebar,
        // DB metadata, and the Záver in lock-step. Defensive copy so we never
        // mutate the clinicalAnalysis reference held elsewhere.
        const finalAnalysis = clinicalAnalysis
          ? { ...clinicalAnalysis, candidateIcdCodes: extractedIcdCodes }
          : null;

        // Save to DB (must complete before sending complete event,
        // so the email API can read the latest encounter_note)
        // Use refreshedMetadata to preserve cached extracted_text from file processing
        // Auto-set title if the visit has none and AI suggested one
        const autoTitle =
          suggestedTitle && !visit.title ? suggestedTitle : undefined;

        // Append this run to generation_history for determinism audit.
        // Keep the most recent 10 runs so the JSONB doesn't grow unbounded.
        const priorHistory = Array.isArray(
          (refreshedMetadata as Record<string, unknown>).generation_history,
        )
          ? ((refreshedMetadata as Record<string, unknown>)
              .generation_history as unknown[])
          : [];
        const historyEntry = {
          at: new Date().toISOString(),
          operation: "generate" as const,
          fingerprint,
          sanity: {
            errors: sanityReport.errors.length,
            warnings: sanityReport.warnings.length,
            interventions: sanityReport.interventions.length,
          },
        };
        const generationHistory = [...priorHistory, historyEntry].slice(-10);

        // Save non-metadata columns and metadata atomically via separate
        // operations:
        // 1. Regular .update() for non-JSONB columns (last-writer-wins, safe)
        // 2. mergeVisitMetadata RPC for JSONB merge (atomic, no race)
        const columnPayload: Record<string, unknown> = {
          encounter_note: generatedNote,
          status: "to_review",
          ...(autoTitle ? { title: autoTitle } : {}),
        };
        // Retry transient fetch failures — long Opus runs leave the Supabase
        // keepalive connection idle past Cloudflare's 100s timeout, causing
        // undici to reuse a dead socket. See lib/supabase/retry.ts.
        const { error: columnError } = await retrySupabaseCall(
          () =>
            supabase
              .from("visits")
              .update(columnPayload)
              .eq("id", visitId) as unknown as Promise<{
              data: null;
              error: unknown;
            }>,
          { label: "generate-save-columns" },
        );

        // Atomic metadata merge — sets new keys and deletes transient ones
        // (generation_pending, recording_session) in one database operation.
        const metadataPartial: Record<string, unknown> = {
          template_id: template.id,
          generation_fingerprint: fingerprint,
          generation_history: generationHistory,
          // Delete transient keys (null → deleted by the RPC)
          generation_pending: null,
          recording_session: null,
          ...(transcriptText ? { transcript: transcriptText } : {}),
          ...(doctorNotes ? { doctor_notes: doctorNotes } : {}),
          // Persist validated facts so future regeneration (template changes)
          // can do a deterministic fact-based rerender instead of prose
          // reformatting. Only stored when facts were actually extracted.
          ...(countFacts(validatedFacts) > 0
            ? { validated_facts: validatedFacts }
            : {}),
          ...(finalAnalysis
            ? {
                clinical_analysis: {
                  inferredSpecialty: finalAnalysis.inferredSpecialty,
                  secondarySpecialty: finalAnalysis.secondarySpecialty,
                  matchedConcepts: finalAnalysis.matchedConcepts,
                  candidateIcdCodes: finalAnalysis.candidateIcdCodes,
                  // Full Pass 1 candidates (pre-filter) for the ICD panel
                  // so the doctor sees all suggestions, not just certain ones
                  suggestedIcdCodes: allCandidateIcdCodes,
                  problemClusters: finalAnalysis.problemClusters,
                  mentionedMedications: finalAnalysis.mentionedMedications,
                },
              }
            : {}),
        };

        let metadataError: unknown = null;
        try {
          await mergeVisitMetadata(supabase, visitId, metadataPartial);
        } catch (err) {
          metadataError = err;
        }

        const saveError = columnError || metadataError;
        if (saveError) {
          logger.error("Failed to save generated content:", saveError);
          // Last-ditch recovery log — the generated note is otherwise lost
          // to the user. Dump it so it can be rescued from server logs.
          logger.error(
            `[generate] LOST NOTE visit=${visitId} note_len=${generatedNote.length}`,
          );
          logger.error(
            `[generate] LOST NOTE BODY visit=${visitId}:\n${generatedNote}`,
          );
          sendEvent({ type: "error", error: "save_failed" });
          safeClose();
          return;
        }

        // Note: Usage logging is handled inside generateFromTemplate for two-pass generation

        // Send final complete event and close stream so client gets response immediately
        sendEvent({
          type: "complete",
          generatedNote,
          suggestedTitle,
          usedChunks,
          templateId: template.id,
          ...(finalAnalysis
            ? {
                clinicalAnalysis: {
                  inferredSpecialty: finalAnalysis.inferredSpecialty,
                  secondarySpecialty: finalAnalysis.secondarySpecialty,
                  candidateIcdCodes: finalAnalysis.candidateIcdCodes,
                  suggestedIcdCodes: allCandidateIcdCodes,
                  matchedConcepts: finalAnalysis.matchedConcepts,
                  problemClusters: finalAnalysis.problemClusters,
                  mentionedMedications: finalAnalysis.mentionedMedications,
                },
              }
            : {}),
        });

        // Send email BEFORE closing stream — client already has the
        // "complete" event so there's no perceived delay. Sending after
        // safeClose() risks the runtime killing the function before the
        // email is dispatched.
        if (sendAsEmail) {
          try {
            await dispatchNoteEmail({
              userId,
              visitId,
              title: autoTitle || visit.title || "Untitled",
              noteHtml: generatedNote,
              language,
            });
            lap("email-sent");
          } catch (err) {
            logger.error("[email] Failed to send note email:", err);
          }
        }

        // Clean up recovery audio blob from storage (fire-and-forget).
        // Check both the request audioPath and metadata for the path.
        const pendingAudioPath =
          audioPath ||
          (
            (refreshedMetadata as Record<string, unknown>)
              ?.generation_pending as { audioPath?: string } | undefined
          )?.audioPath;
        if (pendingAudioPath) {
          supabase.storage
            .from("encounter-files")
            .remove([pendingAudioPath])
            .then(({ error: rmErr }) => {
              if (rmErr)
                logger.warn("[generate] Recovery audio cleanup failed:", rmErr);
              else
                logger.debug(
                  "[generate] Recovery audio cleaned up:",
                  pendingAudioPath,
                );
            });
        }

        lap("total");
        safeClose();
      } catch (err) {
        logger.error("Generate stream error:", err);

        // Handle insufficient context error specially
        if (err instanceof InsufficientContextError) {
          sendEvent({ type: "error", error: "insufficient_context" });
          safeClose();
          return;
        }

        sendEvent({
          type: "error",
          error: err instanceof Error ? err.message : "Generation failed",
        });
        safeClose();
      }
    });

    return sseResponse(readable);
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error("Generate route error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
