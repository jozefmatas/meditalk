import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { retrySupabaseCall } from "@/lib/supabase/retry";
import { mergeVisitMetadata } from "@/lib/supabase/merge-metadata";
import { embedText, LEGACY_EMBEDDING_MODEL } from "@/lib/openai";
import { extractFileText } from "@/lib/extraction/extract-file";
import { transcribeAudio } from "@/lib/elevenlabs";
import {
  DEFAULT_TEMPLATE_ID,
  buildSectionLabelsFromTemplate,
} from "@/lib/templates";
import { resolveTemplate } from "@/lib/templates/server";
import { flattenSectionIds, buildTemplateHtml } from "@/lib/templates/html";
import { scrubPhi } from "@/lib/phi-scrubber";
import { generateNote } from "@/lib/sections/pipeline";
import type { RawSource } from "@/lib/sections/section-agent";
import { logAudit, createAuditContext } from "@/lib/audit";
import { dispatchNoteEmail } from "@/lib/email/send-note-email";
import { createSSEStream, sseResponse } from "@/lib/api/sse";
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
    const allIds = flattenSectionIds(template);
    const sectionLabels = buildSectionLabelsFromTemplate(template, language);

    // Legacy chunk-based encounters: when transcriptText is empty we fall
    // back to semantic retrieval over transcript_chunks. New encounters
    // skip this entirely — transcriptText is already the full source.
    let usedChunks: string[] = [];
    if (!transcriptText) {
      const { count: chunkCount } = await supabase
        .from("transcript_chunks")
        .select("id", { count: "exact", head: true })
        .eq("visit_id", visitId);

      if (chunkCount && chunkCount > 0) {
        try {
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
          } else if (matches && matches.length > 0) {
            const joined = matches
              .map((m: { content: string }) => m.content)
              .join("\n\n");
            transcriptText = joined;
            usedChunks = matches.map((m: { id: string }) => m.id as string);
          }
        } catch (err) {
          logger.warn("[generate] Legacy chunk retrieval failed:", err);
        }
      }
    }

    const hasFileContent = fileTexts.length > 0;
    if (!transcriptText?.trim() && !doctorNotes?.trim() && !hasFileContent) {
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

    // Single raw-source bundle — every section-agent reads from this.
    const source: RawSource = {
      transcript: transcriptText?.trim() || undefined,
      doctorNotes: doctorNotes?.trim() || undefined,
      files: fileTexts.map((f) => ({ name: f.name, text: f.text })),
    };

    logger.debug(
      `[generate] Starting section-agent pipeline (transcript: ${transcriptText?.length ?? 0} chars, files: ${fileTexts.length}, doctorNotes: ${doctorNotes?.length ?? 0} chars)`,
    );
    lap("generation-start");

    const readable = createSSEStream(async ({ sendEvent, safeClose }) => {
      sendEvent({
        type: "streaming_start",
        sectionIds: allIds,
        sectionLabels,
      });

      try {
        const sectionContentsMap: Record<string, string> = {};

        await generateNote({
          template,
          source,
          language,
          usage: { userId, visitId },
          onSection: (section) => {
            sectionContentsMap[section.id] = section.content;
            sendEvent({
              type: "section",
              id: section.id,
              title: section.title,
              content: section.content,
            });
          },
        });

        lap("generation-done");

        const generatedNote = buildTemplateHtml(
          template,
          sectionContentsMap,
          sectionLabels,
          { skipEmpty: true },
        );

        const columnPayload: Record<string, unknown> = {
          encounter_note: generatedNote,
          status: "to_review",
        };
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

        const metadataPartial: Record<string, unknown> = {
          template_id: template.id,
          generation_pending: null,
          recording_session: null,
          ...(transcriptText ? { transcript: transcriptText } : {}),
          ...(doctorNotes ? { doctor_notes: doctorNotes } : {}),
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

        sendEvent({
          type: "complete",
          generatedNote,
          usedChunks,
          templateId: template.id,
        });

        if (sendAsEmail) {
          try {
            await dispatchNoteEmail({
              userId,
              visitId,
              title: visit.title || "Untitled",
              noteHtml: generatedNote,
              language,
            });
            lap("email-sent");
          } catch (err) {
            logger.error("[email] Failed to send note email:", err);
          }
        }

        // Clean up recovery audio blob from storage (fire-and-forget).
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
