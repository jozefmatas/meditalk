import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { retrySupabaseCall } from "@/lib/supabase/retry";
import { mergeVisitMetadata } from "@/lib/supabase/merge-metadata";
import {
  DEFAULT_TEMPLATE_ID,
  buildSectionLabelsFromTemplate,
} from "@/lib/templates";
import { resolveTemplate } from "@/lib/templates/server";
import { buildTemplateHtml, flattenSectionIds } from "@/lib/templates/html";
import { logAudit, createAuditContext } from "@/lib/audit";
import { generateNote } from "@/lib/sections/pipeline";
import type { RawSource } from "@/lib/sections/section-agent";
import { createSSEStream, sseResponse } from "@/lib/api/sse";
import type { SupportedLanguage } from "@/lib/types";
import { getTranscript } from "@/lib/encounters/sources";
import { logger } from "@/lib/logger";

/**
 * Regenerate endpoint — re-runs the section-agent pipeline against the
 * visit's existing raw source (stored transcript + doctor notes + cached
 * file texts) using a possibly-new template. Streams sections via SSE.
 */
export async function POST(request: NextRequest) {
  let userId: string;
  let supabase: Awaited<ReturnType<typeof requireAuth>>["supabase"];
  let authResult: Awaited<ReturnType<typeof requireAuth>>;

  try {
    authResult = await requireAuth();
    userId = authResult.userId;
    supabase = authResult.supabase;
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const visitId: string | undefined = body.visitId;
    const templateId: string | undefined = body.templateId;
    const doctorNotes: string | undefined = body.doctorNotes;

    if (!visitId) {
      return NextResponse.json({ error: "Missing visitId" }, { status: 400 });
    }

    logAudit({
      ...createAuditContext(authResult, request),
      action: "encounter.regenerate",
      resourceType: "encounter",
      resourceId: visitId,
      metadata: { templateId },
    });

    const { data: visit, error: visitError } = await supabase
      .from("visits")
      .select("id, language, metadata, encounter_note")
      .eq("id", visitId)
      .single();

    if (visitError || !visit) {
      return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    }

    const language =
      ((visit.language as string)?.trim() as SupportedLanguage) || "en";

    const visitMeta = (visit.metadata ?? {}) as Record<string, unknown>;
    const uploadedFiles = (visitMeta.files ?? []) as {
      name: string;
      type: string;
      extracted_text?: string | null;
      extraction_status?: string;
      context?: string | null;
    }[];

    const missingText = uploadedFiles.filter(
      (f) => !f.extracted_text && f.extraction_status === "completed",
    );
    if (missingText.length > 0) {
      logger.warn(
        `[regenerate] ${missingText.length} file(s) have status=completed but no extracted_text — omitting: ${missingText.map((f) => f.name).join(", ")}`,
      );
    }
    const failedFiles = uploadedFiles.filter(
      (f) => f.extraction_status === "failed",
    );
    if (failedFiles.length > 0) {
      logger.warn(
        `[regenerate] ${failedFiles.length} file(s) have status=failed — omitting: ${failedFiles.map((f) => f.name).join(", ")}`,
      );
    }

    const fileTexts = uploadedFiles
      .filter((f) => f.extracted_text)
      .map((f) => ({
        name: f.name,
        text: f.extracted_text!,
      }));

    // Transcript: prefer metadata.transcript, fall back to legacy
    // transcript_chunks for old encounters created before batch-only.
    const cachedTranscript = getTranscript(visitMeta);
    let transcriptText: string | undefined;
    let usedChunkIds: string[] = [];

    if (cachedTranscript) {
      transcriptText = cachedTranscript;
    } else {
      const { data: chunks, error: chunksError } = await supabase
        .from("transcript_chunks")
        .select("id, content")
        .eq("visit_id", visitId)
        .order("chunk_index", { ascending: true });

      if (chunksError) {
        logger.error("Chunk fetch error:", chunksError);
      }

      const joined = (chunks ?? [])
        .map((c) => c.content as string)
        .join("\n\n")
        .trim();
      if (joined) transcriptText = joined;
      usedChunkIds = (chunks ?? []).map((c) => c.id as string);
    }

    if (
      !transcriptText?.trim() &&
      !doctorNotes?.trim() &&
      fileTexts.length === 0
    ) {
      return NextResponse.json(
        { error: "No transcript, doctor notes, or file content available" },
        { status: 404 },
      );
    }

    const template = await resolveTemplate(templateId || DEFAULT_TEMPLATE_ID);
    const allIds = flattenSectionIds(template);
    const sectionLabels = buildSectionLabelsFromTemplate(template, language);

    const source: RawSource = {
      transcript: transcriptText,
      doctorNotes: doctorNotes?.trim() || undefined,
      files: fileTexts,
    };

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

        const generatedNote = buildTemplateHtml(
          template,
          sectionContentsMap,
          sectionLabels,
          { skipEmpty: true },
        );

        const { error: columnError } = await retrySupabaseCall(
          () =>
            supabase
              .from("visits")
              .update({ encounter_note: generatedNote })
              .eq("id", visitId) as unknown as Promise<{
              data: null;
              error: unknown;
            }>,
          { label: "regenerate-save-columns" },
        );

        let metadataError: unknown = null;
        try {
          await mergeVisitMetadata(supabase, visitId, {
            template_id: template.id,
            generation_pending: null,
            recording_session: null,
            ...(doctorNotes ? { doctor_notes: doctorNotes } : {}),
          });
        } catch (err) {
          metadataError = err;
        }

        const saveError = columnError || metadataError;
        if (saveError) {
          logger.error("Failed to save regenerated content:", saveError);
          logger.error(
            `[regenerate] LOST NOTE visit=${visitId} note_len=${generatedNote.length}`,
          );
          logger.error(
            `[regenerate] LOST NOTE BODY visit=${visitId}:\n${generatedNote}`,
          );
          sendEvent({ type: "error", error: "save_failed" });
          safeClose();
          return;
        }

        sendEvent({
          type: "complete",
          generatedNote,
          usedChunks: usedChunkIds,
          templateId: template.id,
        });

        safeClose();
      } catch (err) {
        logger.error("Regenerate stream error:", err);
        sendEvent({
          type: "error",
          error: err instanceof Error ? err.message : "Generation failed",
        });
        safeClose();
      }
    });

    return sseResponse(readable);
  } catch (err) {
    logger.error("Regenerate route error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
