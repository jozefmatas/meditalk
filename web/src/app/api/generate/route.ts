import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { DEFAULT_TEMPLATE_ID } from "@/lib/templates";
import { resolveTemplate } from "@/lib/templates/server";
import { resolveSource, createPipelineStream } from "@/lib/pipeline";
import { incrementCleanStreaks } from "@/lib/pipeline/feedback";
import { flattenSectionIds } from "@/lib/templates/html";
import { logAudit, createAuditContext } from "@/lib/audit";
import { dispatchNoteEmail } from "@/lib/email/send-note-email";
import type { SupportedLanguage } from "@/lib/types";
import { getTranscript } from "@/lib/encounters/sources";
import type { RawSource } from "@/lib/sections/section-agent";
import { logger } from "@/lib/logger";

export const maxDuration = 800;

export async function POST(request: NextRequest) {
  const t0 = Date.now();
  const lap = (label: string) =>
    logger.debug(`[generate] ${label} — ${Date.now() - t0}ms`);

  // Auth
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
    const visitId = body.visitId || body.transcriptId;
    const templateId: string | undefined = body.templateId;
    const doctorNotes: string | undefined = body.doctorNotes;
    const transcriptText: string | undefined = body.transcriptText;
    const audioPath: string | undefined = body.audioPath;
    const sendAsEmail: boolean = body.sendAsEmail === true;

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

    // Fetch visit
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
    const visitMeta = (visit.metadata ?? {}) as Record<string, unknown>;

    // Resolve template
    const template = await resolveTemplate(templateId || DEFAULT_TEMPLATE_ID);

    // Shared afterPersist for both modes
    const afterPersist = async (result: {
      generatedNote: string;
      suggestedTitle?: string;
    }) => {
      lap("generation-done");

      if (sendAsEmail) {
        await dispatchNoteEmail({
          userId,
          visitId,
          title: visit.title || result.suggestedTitle || "Untitled",
          noteHtml: result.generatedNote,
          language,
        });
        lap("email-sent");
      }

      // Clean up recovery audio blob (fire-and-forget)
      const pendingAudioPath =
        audioPath ||
        (
          (visitMeta?.generation_pending as { audioPath?: string } | undefined)
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

      // Increment feedback streaks (fire-and-forget)
      incrementCleanStreaks(
        supabase,
        userId,
        template.id,
        flattenSectionIds(template),
      );

      lap("total");
    };

    // Shared completeEventExtras
    const completeEventExtras = (result: {
      clinicalAnalysis?: unknown;
      suggestedTitle?: string;
    }) => ({
      ...(result.clinicalAnalysis
        ? { clinicalAnalysis: result.clinicalAnalysis }
        : {}),
      ...(result.suggestedTitle
        ? { suggestedTitle: result.suggestedTitle }
        : {}),
    });

    // Detect mode: fresh (has transcriptText/audioPath) vs cached (regenerate)
    const isFreshSource = !!(transcriptText || audioPath);

    if (isFreshSource) {
      // ── Fresh mode: defer resolveSource into the SSE stream ──
      // The SSE response starts immediately; resolveSource (which may
      // transcribe audio for 60+ seconds) runs inside beforeSession,
      // sending heartbeat events to keep the connection alive.
      lap("deferred-resolve");

      // Mutable — populated by beforeSession, read by persistGeneration
      const extraMetadata: Record<string, unknown> = {};

      return createPipelineStream({
        sessionInput: {
          supabase,
          userId,
          visitId,
          language,
          rawSource: { transcript: undefined, files: [] },
          fileIds: [],
          visitMetadata: visitMeta,
          template,
        },
        beforeSession: async ({ sendEvent }) => {
          sendEvent({ type: "progress", stage: "preparing" });

          // Heartbeat to keep connection alive during transcription
          const heartbeat = setInterval(() => {
            sendEvent({ type: "progress", stage: "transcribing" });
          }, 12_000);

          try {
            lap("resolve-source-start");
            const resolved = await resolveSource({
              supabase,
              userId,
              visitId,
              language,
              transcriptText,
              doctorNotes,
              audioPath,
              visit: {
                metadata: visitMeta,
                patient_name: visit.patient_name,
                patient_id: visit.patient_id,
              },
            });
            lap("resolve-source-done");

            // Populate extraMetadata for persistence
            if (resolved.transcriptText) {
              extraMetadata.transcript = resolved.transcriptText;
            }
            if (resolved.doctorNotes) {
              extraMetadata.doctor_notes = resolved.doctorNotes;
            }

            sendEvent({ type: "progress", stage: "generating" });

            return {
              rawSource: resolved.rawSource,
              fileIds: resolved.fileTexts.map((f) => f.id),
              visitMetadata: resolved.refreshedMetadata,
            };
          } finally {
            clearInterval(heartbeat);
          }
        },
        persist: {
          supabase,
          visitId,
          metadataPartial: extraMetadata,
          label: "generate",
        },
        completeEventExtras,
        afterPersist,
        label: "generate",
      });
    } else {
      // ── Cached mode (replaces /api/regenerate): build from metadata ──
      const uploadedFiles = (visitMeta.files ?? []) as {
        id: string;
        name: string;
        type: string;
        extracted_text?: string | null;
        context?: string | null;
      }[];

      const fileTexts = uploadedFiles
        .filter((f) => f.extracted_text)
        .map((f) => ({
          id: f.id,
          name: f.name,
          text: f.extracted_text!,
          context: f.context || undefined,
        }));

      const cachedTranscript = getTranscript(visitMeta) ?? undefined;

      const rawSource: RawSource = {
        transcript: cachedTranscript,
        doctorNotes: doctorNotes?.trim() || undefined,
        files: fileTexts.map((f) => ({
          name: f.name,
          text: f.text,
          context: f.context,
        })),
      };
      const fileIds = fileTexts.map((f) => f.id);
      const extraMetadata: Record<string, unknown> = {};

      if (doctorNotes) {
        extraMetadata.doctor_notes = doctorNotes;
      }

      // Validate we have something to generate from
      const hasContent =
        !!rawSource.transcript?.trim() ||
        !!rawSource.doctorNotes?.trim() ||
        (rawSource.files?.length ?? 0) > 0;
      if (!hasContent) {
        return NextResponse.json(
          { error: "insufficient_context" },
          { status: 422 },
        );
      }

      logger.debug(
        `[generate] Starting pipeline (mode=cached, transcript: ${rawSource.transcript?.length ?? 0} chars, files: ${rawSource.files?.length ?? 0}, doctorNotes: ${rawSource.doctorNotes?.length ?? 0} chars)`,
      );
      lap("generation-start");

      return createPipelineStream({
        sessionInput: {
          supabase,
          userId,
          visitId,
          language,
          rawSource,
          fileIds,
          visitMetadata: visitMeta,
          template,
        },
        persist: {
          supabase,
          visitId,
          metadataPartial: extraMetadata,
          label: "generate",
        },
        completeEventExtras,
        afterPersist,
        label: "generate",
      });
    }
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error("Generate route error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
