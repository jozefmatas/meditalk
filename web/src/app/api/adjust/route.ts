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
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/supabase/with-auth";
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
import type { SupportedLanguage, VisitMetadata } from "@/lib/types";
import { getTranscript } from "@/lib/encounters/sources";
import { logger } from "@/lib/logger";

export const maxDuration = 600;

interface UploadedFile {
  id: string;
  name: string;
  type?: string;
  extracted_text?: string | null;
  extraction_status?: string;
  context?: string | null;
}

export const POST = withAuth(async (auth, request) => {
  const { userId, supabase } = auth;

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
    ...createAuditContext(auth, request),
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
  const visitMeta = (visit.metadata ?? {}) as VisitMetadata;
  const priorSectionContents = (visitMeta.section_contents ?? {}) as Record<
    string,
    string
  >;
  const uploadedFiles = (visitMeta.files ?? []) as UploadedFile[];
  const existingTranscript = getTranscript(visitMeta) ?? "";

  // Merge adjustment transcript into the stored transcript
  const mergedTranscript = [existingTranscript, adjustmentTranscript]
    .filter((s): s is string => !!s?.trim())
    .join("\n\n");

  const template = await resolveTemplate(templateId || DEFAULT_TEMPLATE_ID);
  const sectionLabels = buildSectionLabelsFromTemplate(template, language);

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
      metadataPartial: mergedTranscript.trim()
        ? { transcript: mergedTranscript.trim() }
        : {},
      label: "adjust",
    },
    label: "adjust",
  });
});
