/**
 * Adjust endpoint — incremental re-render of a previously-generated
 * note when the doctor dictates / uploads a small delta mid-visit.
 *
 * Differs from /api/generate in three ways:
 *   1. Accepts ONLY the delta (adjustmentTranscript + optional new
 *      file ids) — never the full doctor_notes blob. Avoids the
 *      previous-note inflation that caused 17K char input bloat.
 *   2. A Haiku "router" decides which sections are plausibly affected
 *      by the delta. Only those sections re-render; everything else
 *      keeps its prior content from visit.metadata.section_contents.
 *   3. Uses the file-focus cache so Past-mode documents don't get
 *      re-filtered on every adjust.
 *
 * Záver is only re-run if the router flagged a diagnosis-affecting
 * section (OA, TO, any section label containing "záver"). Otherwise
 * we keep the existing Záver text intact.
 */
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
import {
  generateNote,
  findZaverSection,
  runCriticAndReconcilers,
} from "@/lib/sections/pipeline";
import { suggestIcdCodes } from "@/lib/sections/suggest-icd";
import {
  applyFileFocusDirectives,
  type FileFocusCache,
} from "@/lib/sections/file-focus";
import { formatZaverFromSuggestions } from "@/lib/sections/format-zaver";
import { routeAdjustment } from "@/lib/sections/adjust-router";
import type { RawSource, RenderedSection } from "@/lib/sections/section-agent";
import type { TemplateSection } from "@/lib/templates/types";
import { createSSEStream, sseResponse } from "@/lib/api/sse";
import { logAudit, createAuditContext } from "@/lib/audit";
import type { SupportedLanguage } from "@/lib/types";
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
    const fileFocusCache = (visitMeta.file_focus_cache ?? {}) as FileFocusCache;
    const uploadedFiles = (visitMeta.files ?? []) as UploadedFile[];
    const existingTranscript = getTranscript(visitMeta) ?? "";

    // Merge adjustment transcript into the stored transcript — the
    // adjustment is cumulatively part of the encounter from now on.
    const mergedTranscript = [existingTranscript, adjustmentTranscript]
      .filter((s): s is string => !!s?.trim())
      .join("\n\n");

    const template = await resolveTemplate(templateId || DEFAULT_TEMPLATE_ID);
    const allIds = flattenSectionIds(template);
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

    // File-focus with cache. The cache is seeded from metadata and
    // updated in place; we write any changes back after generation.
    let updatedFileFocusCache: FileFocusCache | null = null;
    const source = await applyFileFocusDirectives(
      rawSource,
      language,
      { userId, visitId },
      {
        fileIds: allFiles.map((f) => f.id),
        cache: fileFocusCache,
        onCacheUpdate: (next) => {
          updatedFileFocusCache = next;
        },
      },
    );

    // Router: which sections does the delta touch? Falls back to "all"
    // on error (returned by routeAdjustment itself).
    const leafSections = collectLeafSectionsForRouter(template, sectionLabels);
    const newFileTexts = allFiles
      .filter((f) => newFileIds.includes(f.id))
      .map((f) => ({ name: f.name, text: f.text }));
    const { affectedSectionIds, reasoning } = await routeAdjustment({
      sections: leafSections,
      adjustmentTranscript,
      newFileTexts,
      language: language === "cs" ? "cs" : language === "en" ? "en" : "sk",
      usage: { userId, visitId },
    });
    const affectedSet = new Set(affectedSectionIds);

    // Vitals are measured as one session. If ANY vital section is
    // flagged, expand to the whole objective-exam group so stale
    // cross-talk doesn't survive — e.g. doctor dictates only TK/Výška/
    // Hmotnosť; Pulz and EKG must also reconsider themselves (they
    // may have an invented value from an older pre-fix generate).
    const vitalGroupIds = leafSections
      .filter((s) => isVitalOrExamLabel(s.label))
      .map((s) => s.id);
    if (vitalGroupIds.some((id) => affectedSet.has(id))) {
      for (const id of vitalGroupIds) affectedSet.add(id);
    }
    logger.debug(
      `[adjust] router → ${affectedSectionIds.length} section(s) (reasoning="${reasoning ?? ""}"); expanded to ${affectedSet.size} after vital-group rule`,
    );
    const sectionContentsMap: Record<string, string> = {
      ...priorSectionContents,
    };

    const readable = createSSEStream(async ({ sendEvent, safeClose }) => {
      sendEvent({
        type: "streaming_start",
        sectionIds: allIds,
        sectionLabels,
        // Pre-populate streaming with prior contents so the UI shows
        // existing sections immediately and only animates the ones
        // being refreshed.
        seed: priorSectionContents,
      });

      try {
        // Run affected sections through the pipeline. Pass the full
        // merged source so each re-rendering section sees both prior
        // evidence and the new delta.
        await generateNote({
          template,
          source,
          language,
          usage: { userId, visitId },
          leafIdFilter: affectedSet,
          onSection: (section: RenderedSection) => {
            sectionContentsMap[section.id] = section.content;
            sendEvent({
              type: "section",
              id: section.id,
              title: section.title,
              content: section.content,
            });
          },
        });

        // Záver — re-run suggester + critic only if the router flagged
        // a diagnosis-affecting section (OA, TO, Záver, or the
        // Diagnostický záver block). Otherwise keep existing Záver.
        const zaver = findZaverSection(
          template,
          language === "cs" ? "cs" : language === "en" ? "en" : "sk",
        );
        const shouldRerunZaver =
          !!zaver &&
          (affectedSet.has(zaver.id) ||
            leafSections.some(
              (s) =>
                affectedSet.has(s.id) &&
                /^(oa|osobna|past\s+medical|pmh|to|terajsie|hpi|history|anamneza)/i.test(
                  s.id + " " + s.label,
                ),
            ));

        if (shouldRerunZaver && zaver) {
          const suggestedIcdCodes = await suggestIcdCodes(source, language, {
            userId,
            visitId,
          });
          const draft = formatZaverFromSuggestions(suggestedIcdCodes);
          const finalZaver = draft
            ? await runCriticAndReconcilers({
                draftContent: draft,
                source,
                config: {
                  id: zaver.id,
                  title: zaver.title,
                  context: zaver.context,
                  model: "haiku",
                  reconcilers: zaver.reconcilers,
                  critic: zaver.critic,
                },
                language:
                  language === "cs" ? "cs" : language === "en" ? "en" : "sk",
                usage: { userId, visitId },
                templateSystemPrompt: template.systemPrompt,
              })
            : draft;

          if (finalZaver !== undefined) {
            sectionContentsMap[zaver.id] = finalZaver;
            sendEvent({
              type: "section",
              id: zaver.id,
              title: zaver.title,
              content: finalZaver,
            });
          }
        }

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
              .update({
                encounter_note: generatedNote,
                status: "to_review",
              })
              .eq("id", visitId) as unknown as Promise<{
              data: null;
              error: unknown;
            }>,
          { label: "adjust-save-columns" },
        );

        const metadataPartial: Record<string, unknown> = {
          template_id: template.id,
          generation_pending: null,
          section_contents: sectionContentsMap,
          ...(mergedTranscript.trim()
            ? { transcript: mergedTranscript.trim() }
            : {}),
          ...(updatedFileFocusCache
            ? { file_focus_cache: updatedFileFocusCache }
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
          logger.error("[adjust] Failed to save adjusted note:", saveError);
          sendEvent({ type: "error", error: "save_failed" });
          safeClose();
          return;
        }

        sendEvent({
          type: "complete",
          generatedNote,
          templateId: template.id,
        });
        safeClose();
      } catch (err) {
        logger.error("[adjust] pipeline failed:", err);
        sendEvent({ type: "error", error: "adjust_failed" });
        safeClose();
      }
    });

    return sseResponse(readable);
  } catch (err) {
    logger.error("[adjust] top-level error:", err);
    return NextResponse.json({ error: "adjust_failed" }, { status: 500 });
  }
}

/**
 * Labels that belong to the physical-exam / vitals group — when the
 * adjustment touches any of them the whole group should re-render so
 * stale "invented" values from earlier pre-fix generates don't
 * survive silently.
 */
const VITAL_EXAM_LABELS = new Set([
  "krvny tlak",
  "tk",
  "pulz",
  "sf",
  "vyska",
  "hmotnost",
  "bmi",
  "ekg",
  "ecg",
  "celkove vysetrenie",
  "celkovy stav",
  "celkovy nalez",
  "fyzikalne vysetrenie",
  "fyzikalni vysetreni",
  "objektivne vysetrenie",
  "objektivni vysetreni",
  "height",
  "weight",
  "blood pressure",
  "heart rate",
  "general condition",
  "general examination",
  "physical examination",
]);

function foldLabel(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[:\s]+$/g, "");
}

function isVitalOrExamLabel(label: string): boolean {
  return VITAL_EXAM_LABELS.has(foldLabel(label));
}

/**
 * Build the router's section list — each leaf's id + display label +
 * one-line contract hint.
 */
function collectLeafSectionsForRouter(
  template: import("@/lib/templates/types").Template,
  sectionLabels: Record<string, string>,
): Array<{ id: string; label: string; contractHint: string }> {
  const out: Array<{ id: string; label: string; contractHint: string }> = [];
  const walk = (nodes: TemplateSection[]) => {
    for (const s of nodes) {
      if (s.subsections?.length) {
        walk(s.subsections);
        continue;
      }
      const label = sectionLabels[s.id] ?? s.id;
      const hint =
        (s.context ?? "").split(/\n/)[0]?.slice(0, 160)?.trim() ?? "";
      out.push({ id: s.id, label, contractHint: hint });
    }
  };
  walk(template.sections);
  return out;
}
