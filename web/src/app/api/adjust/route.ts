/**
 * Adjust endpoint — incremental re-render of a previously-generated
 * note when the doctor dictates / uploads a small delta mid-visit.
 *
 * Differs from /api/generate in three ways:
 *   1. Accepts ONLY the delta (adjustmentTranscript + optional new
 *      file ids) — never the full doctor_notes blob.
 *   2. A Haiku "router" decides which sections are plausibly affected
 *      by the delta. Only those sections re-render; everything else
 *      keeps its prior content from visit.metadata.section_contents.
 *   3. Uses the file-focus cache so Past-mode documents don't get
 *      re-filtered on every adjust.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import {
  DEFAULT_TEMPLATE_ID,
  buildSectionLabelsFromTemplate,
} from "@/lib/templates";
import { resolveTemplate } from "@/lib/templates/server";
import { routeAdjustment } from "@/lib/sections/adjust-router";
import { createPipelineStream } from "@/lib/pipeline";
import {
  collectLeafSectionsForRouter,
  expandVitalGroup,
} from "@/lib/pipeline/adjust-helpers";
import { extractSkeleton } from "@/lib/sections/note-skeleton";
import { logAudit, createAuditContext } from "@/lib/audit";
import type { RawSource } from "@/lib/sections/section-agent";
import type { SupportedLanguage } from "@/lib/types";
import { getTranscript } from "@/lib/encounters/sources";
import { extractFileText } from "@/lib/extraction/extract-file";
import { logger } from "@/lib/logger";

export const maxDuration = 600;

interface UploadedFile {
  id: string;
  name: string;
  type?: string;
  path?: string;
  extracted_text?: string | null;
  extraction_status?: string;
  context?: string | null;
}

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
    const adjustmentTranscript: string | undefined = body.adjustmentTranscript;
    const newFileIds: string[] = Array.isArray(body.newFileIds)
      ? body.newFileIds.filter(
          (x: unknown): x is string => typeof x === "string",
        )
      : [];

    if (!visitId) {
      return NextResponse.json({ error: "Missing visitId" }, { status: 400 });
    }
    if (!adjustmentTranscript?.trim() && newFileIds.length === 0) {
      return NextResponse.json(
        {
          error:
            "Nothing to adjust — provide adjustmentTranscript or newFileIds",
        },
        { status: 400 },
      );
    }

    logAudit({
      ...createAuditContext(authResult, request),
      action: "encounter.adjust",
      resourceType: "encounter",
      resourceId: visitId,
      metadata: { templateId, newFileIds: newFileIds.length },
    });

    // Fetch visit
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
    const priorSectionContents = (visitMeta.section_contents ?? {}) as Record<
      string,
      string
    >;
    const uploadedFiles = (visitMeta.files ?? []) as UploadedFile[];
    const existingTranscript = getTranscript(visitMeta) ?? "";

    // Deduplicate: only append adjustmentTranscript if it's genuinely new
    // content. The client's prepareSource() re-sends the existing transcript
    // when there's no new recording blob, so we must detect and skip that.
    const isNewDelta =
      !!adjustmentTranscript?.trim() &&
      adjustmentTranscript.trim() !== existingTranscript.trim();

    const mergedTranscript = isNewDelta
      ? [existingTranscript, adjustmentTranscript]
          .filter((s): s is string => !!s?.trim())
          .join("\n\n")
      : existingTranscript;

    const template = await resolveTemplate(templateId || DEFAULT_TEMPLATE_ID);
    const sectionLabels = buildSectionLabelsFromTemplate(template, language);

    // Re-extract files with failed extraction_status (e.g. after a bug fix)
    const failedFiles = uploadedFiles.filter(
      (f) =>
        f.extraction_status === "failed" &&
        !f.extracted_text &&
        f.type &&
        f.path,
    );
    if (failedFiles.length > 0) {
      logger.debug(
        `[adjust] Re-extracting ${failedFiles.length} failed file(s)`,
      );
      await Promise.allSettled(
        failedFiles.map(async (f) => {
          try {
            const result = await extractFileText({
              file: {
                id: f.id,
                type: f.type!,
                path: f.path!,
                name: f.name,
              },
              supabase,
              userId,
              visitId,
              language,
            });
            f.extracted_text = result.text;
            f.extraction_status = "completed";
            logger.debug(
              `[adjust] Re-extracted ${f.name}: ${result.text.length} chars`,
            );
          } catch (err) {
            logger.warn(`[adjust] Re-extraction failed for ${f.name}:`, err);
          }
        }),
      );
    }

    const allFiles = uploadedFiles
      .filter((f) => f.extracted_text)
      .map((f) => ({
        id: f.id,
        name: f.name,
        text: f.extracted_text!,
        context: f.context || undefined,
      }));

    const rawSource: RawSource = {
      transcript: mergedTranscript.trim() || undefined,
      files: allFiles.map((f) => ({
        name: f.name,
        text: f.text,
        context: f.context,
      })),
    };

    // Router: which sections does the delta touch?
    const leafSections = collectLeafSectionsForRouter(template, sectionLabels);
    const newFileTexts = allFiles
      .filter((f) => newFileIds.includes(f.id))
      .map((f) => ({ name: f.name, text: f.text }));

    // Skeleton for router + downstream renderers
    const skeleton = await extractSkeleton(
      rawSource,
      language === "cs" ? "cs" : language === "en" ? "en" : "sk",
      { userId, visitId },
    );

    const { affectedSectionIds, reasoning } = await routeAdjustment({
      sections: leafSections,
      adjustmentTranscript,
      newFileTexts,
      language: language === "cs" ? "cs" : language === "en" ? "en" : "sk",
      usage: { userId, visitId },
      skeleton,
    });

    // Expand vital group
    const affectedSet = expandVitalGroup(
      new Set(affectedSectionIds),
      template,
      sectionLabels,
    );

    logger.debug(
      `[adjust] router → ${affectedSectionIds.length} section(s) (reasoning="${reasoning ?? ""}"); expanded to ${affectedSet.size} after vital-group rule`,
    );

    return createPipelineStream({
      sessionInput: {
        supabase,
        userId,
        visitId,
        language,
        rawSource,
        fileIds: allFiles.map((f) => f.id),
        visitMetadata: visitMeta,
        template,
        leafIdFilter: affectedSet,
        priorSectionContents,
        skipFeedback: true,
      },
      persist: {
        supabase,
        visitId,
        metadataPartial: isNewDelta
          ? { transcript: mergedTranscript.trim() }
          : {},
        label: "adjust",
      },
      label: "adjust",
    });
  } catch (err) {
    logger.error("[adjust] top-level error:", err);
    return NextResponse.json({ error: "adjust_failed" }, { status: 500 });
  }
}
