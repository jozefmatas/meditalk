import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { retrySupabaseCall } from "@/lib/supabase/retry";
import { mergeVisitMetadata } from "@/lib/supabase/merge-metadata";
import {
  anthropic,
  GENERATION_MODELS,
  MODEL_FALLBACK_DELAY,
  buildFactBasedSystemPrompt,
  buildTemplateSystemPrompt,
  buildTemplateUserMessage,
  generateEncounterTitle,
} from "@/lib/anthropic";
import {
  DEFAULT_TEMPLATE_ID,
  buildSectionLabelsFromTemplate,
  buildSectionContextsFromTemplate,
} from "@/lib/templates";
import { resolveTemplate } from "@/lib/templates/server";
import { buildTemplateHtml, flattenSectionIds } from "@/lib/templates/html";
import { logUsage } from "@/lib/usage";
import { logAudit, createAuditContext } from "@/lib/audit";
import {
  runClinicalAnalysis,
  buildEnrichedSystemPrompt,
  extractJson,
  runFactExtraction,
  validateFacts,
  resolveFacts,
  countFacts,
  emptyExtractedFacts,
  computeFingerprint,
  filterCertainIcdCandidates,
} from "@/lib/clinical";
import type {
  ExtractedFacts,
  FactExtractionInput,
} from "@/lib/clinical/fact-extraction";
import {
  validateIcdDescriptions,
  extractIcdCodesFromSections,
} from "@/lib/clinical/icd-index";
import {
  createSSEStream,
  sseResponse,
  extractSectionsFromStream,
} from "@/lib/api/sse";
import type { ClinicalAnalysis, CandidateIcdCode } from "@/lib/clinical/types";
import type { SupportedLanguage } from "@/lib/types";
import { getTranscript } from "@/lib/encounters/sources";
import { parseNoteToSectionMap } from "@/lib/parse-note-sections";
import { logger } from "@/lib/logger";

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: "English",
  sk: "Slovak",
  cs: "Czech",
};

/**
 * Streaming regeneration endpoint.
 *
 * Skips OpenAI embedding + vector search (chunks are fetched directly by visit_id).
 * Streams Anthropic response as SSE so sections appear progressively on the client.
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

    // Fetch visit metadata (RLS enforces ownership).
    // The transcript is in metadata.transcript (batch-only encounters);
    // legacy transcript_chunks are kept as fallback for old encounters.
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

    // Collect already-extracted file texts from metadata.
    // Unlike the generate route, regenerate does NOT re-extract — it uses
    // cached extracted_text from the prior generation.
    const visitMeta = (visit.metadata ?? {}) as Record<string, unknown>;
    const uploadedFiles = (visitMeta.files ?? []) as {
      name: string;
      type: string;
      extracted_text?: string | null;
      extraction_status?: string;
      context?: string | null;
    }[];

    // Log files that will be omitted (no extracted_text despite being "completed")
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
        type: f.type,
        text: f.extracted_text!,
        context: f.context || undefined,
      }));

    // Transcript resolution: prefer metadata.transcript, then fall back to
    // legacy transcript_chunks for old encounters created before the batch-only
    // migration. New encounters always have metadata.transcript.
    const transcript = getTranscript(visitMeta);
    let chunkContents: string[];
    let usedChunkIds: string[];

    if (transcript) {
      chunkContents = [transcript];
      usedChunkIds = [];
    } else {
      // @deprecated — legacy transcript_chunks path for old encounters only.
      const { data: chunks, error: chunksError } = await supabase
        .from("transcript_chunks")
        .select("id, content")
        .eq("visit_id", visitId)
        .order("chunk_index", { ascending: true });

      if (chunksError) {
        logger.error("Chunk fetch error:", chunksError);
      }

      chunkContents = chunks?.map((c) => c.content) ?? [];
      usedChunkIds = chunks?.map((c) => c.id as string) ?? [];
    }

    if (
      chunkContents.length === 0 &&
      !doctorNotes?.trim() &&
      fileTexts.length === 0
    ) {
      return NextResponse.json(
        {
          error: "No transcript, doctor notes, or file content available",
        },
        { status: 404 },
      );
    }

    // Resolve template from DB
    const template = await resolveTemplate(templateId || DEFAULT_TEMPLATE_ID);
    const allIds = flattenSectionIds(template);

    // Build section labels and contexts directly from the template
    const sectionLabels = buildSectionLabelsFromTemplate(template, language);
    const sectionContexts = buildSectionContextsFromTemplate(template);

    // Determine generation path: fast reformat vs full generation
    const existingNote = visit.encounter_note as string | null;
    const oldTemplateId = (visitMeta.template_id as string) || null;
    const oldTemplate = oldTemplateId
      ? await resolveTemplate(oldTemplateId).catch(() => null)
      : null;

    let clinicalAnalysis: ClinicalAnalysis | null = null;
    const cachedAnalysis = visitMeta.clinical_analysis as
      | Record<string, unknown>
      | undefined;

    let streamModels: readonly string[];
    let systemPrompt: string;
    let userMessage: string;
    let operationType: "regenerate" | "rerender" | "reformat" = "regenerate";
    let validatedFacts: ExtractedFacts = emptyExtractedFacts();
    let factWarnings: string[] = [];
    let factRemovedCount = 0;
    let factResolutionDropCount = 0;
    // Full Pass 1 candidates (pre-filter) for the ICD panel suggestions.
    // Set in the full path before Pass 1.7; for the fast path (reformat),
    // preserved from the cached analysis if available.
    let allCandidateIcdCodes: CandidateIcdCode[] = [];

    // Check for cached validated facts from previous generation
    const cachedValidatedFacts = visitMeta.validated_facts as
      | ExtractedFacts
      | undefined;
    const hasCachedFacts =
      cachedValidatedFacts && countFacts(cachedValidatedFacts) > 0;
    const isTemplateChange =
      existingNote && oldTemplate && oldTemplateId !== template.id;

    if (isTemplateChange && hasCachedFacts) {
      // ─── STRUCTURED PATH: Fact-based rerender with cached facts ───
      // When validated facts exist from a prior generation, re-render them
      // into the new template. This is more reliable than prose reformatting
      // because facts are already validated/resolved and section assignment
      // is deterministic — no information loss from HTML → text → LLM → HTML.
      validatedFacts = cachedValidatedFacts;
      operationType = "rerender";
      streamModels = GENERATION_MODELS;

      // Load cached analysis for enrichment (specialty, ICD, medications)
      if (cachedAnalysis?.inferredSpecialty) {
        clinicalAnalysis = {
          ...cachedAnalysis,
          usage: { inputTokens: 0, outputTokens: 0 },
        } as ClinicalAnalysis;
        allCandidateIcdCodes =
          (cachedAnalysis.suggestedIcdCodes as CandidateIcdCode[]) ??
          clinicalAnalysis.candidateIcdCodes ??
          [];
      }

      // Use the lean fact-based prompt (same as the main generation path)
      const basePrompt = buildFactBasedSystemPrompt(
        template,
        language,
        sectionLabels,
        sectionContexts,
      );
      systemPrompt = clinicalAnalysis
        ? buildEnrichedSystemPrompt(
            basePrompt,
            clinicalAnalysis,
            language,
            true,
          )
        : basePrompt;
      userMessage = buildTemplateUserMessage(
        chunkContents,
        template,
        doctorNotes,
        fileTexts,
        validatedFacts,
        sectionLabels,
        sectionContexts,
      );

      logger.debug(
        `[regenerate] Structured rerender — ${countFacts(validatedFacts)} cached facts, template ${oldTemplateId} → ${template.id}`,
      );
    } else if (isTemplateChange) {
      // ─── LEGACY FAST PATH: Prose reformat for old encounters without facts ───
      const sectionMap = parseNoteToSectionMap(existingNote!, oldTemplate!);
      operationType = "reformat";

      const currentSections = Object.entries(sectionMap)
        .filter(([, content]) => content.trim())
        .map(([id, content]) => `[${id}]: ${content}`)
        .join("\n\n");

      const langLabel = LANGUAGE_LABELS[language];
      const sectionList = allIds
        .map((id) => {
          const label = sectionLabels[id] || id;
          const context = sectionContexts[id];
          return context
            ? `- "${id}": ${label}\n  Context: ${context}`
            : `- "${id}": ${label}`;
        })
        .join("\n");

      streamModels = GENERATION_MODELS;

      systemPrompt = `You reorganize medical documentation between template formats.
Rules:
1. Preserve ALL clinical information. Do not omit any details from the source.
2. Preserve the EXACT tone, voice, and writing style of the original note. Do not rephrase, simplify, or embellish — copy the wording verbatim where it fits and only restructure when necessary to fit a different section.
3. Write in ${langLabel}, except medical terms.
4. Sections with no relevant content: use empty string "".
5. Follow each section's Context instructions carefully (e.g., exclude certain types of information if specified).
6. Return valid JSON with keys: ${allIds.map((id) => `"${id}"`).join(", ")}`;

      userMessage = `CURRENT NOTE SECTIONS:\n\n${currentSections}\n\nReorganize into these target template sections:\n${sectionList}\n\nReturn valid JSON.`;

      // Load cached analysis for the SSE event (not used in prompt)
      if (cachedAnalysis?.inferredSpecialty) {
        clinicalAnalysis = {
          ...cachedAnalysis,
          usage: { inputTokens: 0, outputTokens: 0 },
        } as ClinicalAnalysis;
        allCandidateIcdCodes =
          (cachedAnalysis.suggestedIcdCodes as CandidateIcdCode[]) ??
          clinicalAnalysis.candidateIcdCodes ??
          [];
      }

      logger.debug(
        `[regenerate] Legacy prose reformat — no cached facts, template ${oldTemplateId} → ${template.id}`,
      );
    } else {
      // ─── FULL PATH: Generate from transcript with Opus ───
      streamModels = GENERATION_MODELS;

      if (cachedAnalysis?.inferredSpecialty) {
        clinicalAnalysis = {
          ...cachedAnalysis,
          usage: { inputTokens: 0, outputTokens: 0 },
        } as ClinicalAnalysis;
      } else if (chunkContents.length > 0) {
        try {
          clinicalAnalysis = await runClinicalAnalysis(
            chunkContents,
            language,
            { userId, visitId },
          );
        } catch (analysisErr) {
          logger.warn(
            "Clinical analysis failed, proceeding without enrichment:",
            analysisErr,
          );
        }
      }

      // Pass 1.5 — Structured fact extraction (same contract as /api/generate).
      // Non-fatal: on failure we fall through with an empty fact set.
      const factExtractionInput: FactExtractionInput = {
        chunks: chunkContents,
        doctorNotes: doctorNotes?.trim() ? doctorNotes : undefined,
        files: fileTexts.length > 0 ? fileTexts : undefined,
      };
      const hasAnyFactSource =
        factExtractionInput.chunks.length > 0 ||
        !!factExtractionInput.doctorNotes ||
        (factExtractionInput.files?.length ?? 0) > 0;
      if (hasAnyFactSource) {
        try {
          const rawFacts = await runFactExtraction(
            factExtractionInput,
            language,
            { userId, visitId },
          );
          const validation = validateFacts(rawFacts, factExtractionInput, {
            pass1: clinicalAnalysis,
            locale: language,
          });
          // Pass 1.6 — deterministic fact resolution (see fact-resolver.ts).
          const resolution = resolveFacts(
            validation.validFacts,
            factExtractionInput,
            language,
          );
          validatedFacts = resolution.resolvedFacts;
          factWarnings = validation.warnings;
          factRemovedCount = validation.counts.removed;
          factResolutionDropCount = resolution.counts.total;
          logger.debug(
            `[regenerate] Fact extraction — ${validation.counts.total} valid, ${factRemovedCount} removed by validator, ${factResolutionDropCount} dropped by resolver (${resolution.counts.correctionDrops} correction), ${factWarnings.length} warnings`,
          );
        } catch (err) {
          logger.warn(
            "[regenerate] Fact extraction failed, proceeding without fact contract:",
            err,
          );
        }
      }

      // Preserve the full candidate list before certainty filtering.
      allCandidateIcdCodes = clinicalAnalysis?.candidateIcdCodes ?? [];

      // Pass 1.7 — Diagnosis certainty filter. See generate route for details.
      // Drops candidate ICD codes that are not lexically grounded in the
      // validated diagnosis/history facts so Opus only sees the certain set.
      if (clinicalAnalysis && clinicalAnalysis.candidateIcdCodes.length > 0) {
        const certainty = filterCertainIcdCandidates(
          clinicalAnalysis.candidateIcdCodes,
          validatedFacts,
        );
        logger.debug(
          `[regenerate] ICD certainty — kept ${certainty.counts.kept}/${certainty.counts.total}`,
          certainty.dropped.slice(0, 5),
        );
        clinicalAnalysis = {
          ...clinicalAnalysis,
          candidateIcdCodes: certainty.kept,
        };
      }

      const hasFactsForPrompt = countFacts(validatedFacts) > 0;
      const baseSystemPrompt = hasFactsForPrompt
        ? buildFactBasedSystemPrompt(
            template,
            language,
            sectionLabels,
            sectionContexts,
          )
        : buildTemplateSystemPrompt(
            template,
            language,
            sectionLabels,
            sectionContexts,
          );
      systemPrompt = clinicalAnalysis
        ? buildEnrichedSystemPrompt(
            baseSystemPrompt,
            clinicalAnalysis,
            language,
            hasFactsForPrompt,
          )
        : baseSystemPrompt;
      userMessage = buildTemplateUserMessage(
        chunkContents,
        template,
        doctorNotes,
        fileTexts,
        hasFactsForPrompt ? validatedFacts : undefined,
        sectionLabels,
        sectionContexts,
      );
    }

    // Stream Anthropic response as SSE (with model fallback on overloaded errors)

    const sectionIdSet = new Set(allIds);

    const readable = createSSEStream(async ({ sendEvent, safeClose }) => {
      let inputTokens = 0;
      let outputTokens = 0;

      // Notify client that clinical analysis is complete
      if (clinicalAnalysis) {
        sendEvent({
          type: "analysis_complete",
          specialty: clinicalAnalysis.inferredSpecialty,
          icdCodeCount: clinicalAnalysis.candidateIcdCodes.length,
          conceptCount: clinicalAnalysis.matchedConcepts.length,
        });
      }

      // Phase 2 — notify client that fact extraction is complete (full path only;
      // the fast reformat path doesn't run extraction because it reshuffles the
      // existing note rather than re-grounding from source material).
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

      let finalMessage: Awaited<
        ReturnType<
          ReturnType<typeof anthropic>["messages"]["stream"]
        >["finalMessage"]
      >;
      let usedModel = streamModels[0];

      // Try each model in the fallback chain; on overload, move to the next model
      for (let mi = 0; mi < streamModels.length; mi++) {
        const model = streamModels[mi];

        sendEvent({
          type: "streaming_start",
          sectionIds: allIds,
          sectionLabels,
        });

        let accumulated = "";
        const emittedSections = new Set<string>();

        try {
          const stream = anthropic().messages.stream({
            model,
            max_tokens: 8192,
            temperature: 0,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
          });

          stream.on("text", (delta) => {
            accumulated += delta;
            extractSectionsFromStream(
              accumulated,
              sectionIdSet,
              emittedSections,
              sectionLabels,
              (id, title, content) => {
                sendEvent({ type: "section", id, title, content });
              },
            );
          });

          finalMessage = await stream.finalMessage();
          usedModel = model;
          break; // Success
        } catch (err) {
          const isOverloaded =
            err instanceof Error &&
            err.message.toLowerCase().includes("overloaded");
          if (isOverloaded && mi < streamModels.length - 1) {
            logger.warn(
              `[regenerate] ${model} overloaded, falling back to ${streamModels[mi + 1]} in ${MODEL_FALLBACK_DELAY}ms`,
            );
            await new Promise((r) => setTimeout(r, MODEL_FALLBACK_DELAY));
            continue;
          }
          throw err;
        }
      }

      try {
        inputTokens = finalMessage!.usage.input_tokens;
        outputTokens = finalMessage!.usage.output_tokens;

        // Parse the full JSON for the final result
        const fullText =
          finalMessage!.content[0].type === "text"
            ? finalMessage!.content[0].text
            : "";

        let parsed: Record<string, string>;
        try {
          parsed = extractJson<Record<string, string>>(fullText);
        } catch {
          sendEvent({ type: "error", error: "Failed to parse response" });
          safeClose();
          return;
        }

        delete parsed.letter; // ignored (feature removed)
        let suggestedTitle =
          typeof parsed.title === "string" ? parsed.title : "";
        delete parsed.title;
        const isReformatPath =
          operationType === "rerender" || operationType === "reformat";
        if (isReformatPath) {
          suggestedTitle = "";
        }

        const sectionContents: Record<string, string> = {};
        for (const id of allIds) {
          const value = parsed[id];
          const rawText = typeof value === "string" ? value : "";
          // Phase 1.8: validate ICD descriptions (replace hallucinated text with
          // canonical CSV descriptions). Must run before extraction.
          sectionContents[id] = rawText
            ? validateIcdDescriptions(rawText, language)
            : "";
        }

        // Phase 1.7: extract ICD codes that actually appear in the generated
        // report. These override the Pass 1 candidates so the sidebar stays
        // in lock-step with the report's Záver.
        const extractedIcdCodes = extractIcdCodesFromSections(
          sectionContents,
          language,
        );

        // Dedicated title generation — temperature 0, grounded ONLY in the
        // extracted ICDs. This overrides the title from the main Opus call,
        // which was prone to hallucinating details not present in the
        // primary diagnosis. Skipped on the reformat path (we keep the
        // existing title there).
        if (!isReformatPath) {
          const titleFromIcd = await generateEncounterTitle(
            extractedIcdCodes,
            language,
            { userId, visitId },
          );
          suggestedTitle =
            titleFromIcd || extractedIcdCodes[0]?.description || suggestedTitle;
        }

        // Defensive copy — never mutate cachedAnalysis or clinicalAnalysis.
        const finalAnalysis: ClinicalAnalysis | null = clinicalAnalysis
          ? { ...clinicalAnalysis, candidateIcdCodes: extractedIcdCodes }
          : null;

        const generatedNote = buildTemplateHtml(
          template,
          sectionContents,
          sectionLabels,
        );

        // Save to DB (must complete before sending complete event,
        // so the email API can read the latest encounter_note)
        const existingMetadata =
          (visit.metadata as Record<string, unknown>) || {};

        // Determinism audit — fingerprint the exact inputs sent to the
        // generator so divergent outputs can be traced to either upstream
        // input drift or downstream LLM sampling variance. See
        // lib/clinical/fingerprint.ts for details.
        const fingerprint = computeFingerprint({
          templateId: template.id,
          language,
          transcriptChunks: chunkContents,
          doctorNotes,
          files: fileTexts,
          clinicalAnalysis,
          facts: validatedFacts,
          systemPrompt,
          userMessage,
        });
        logger.info(
          `[regenerate] fingerprint visit=${visitId} composite=${fingerprint.composite}`,
        );
        const priorHistory = Array.isArray(existingMetadata.generation_history)
          ? (existingMetadata.generation_history as unknown[])
          : [];
        const historyEntry = {
          at: new Date().toISOString(),
          operation: operationType,
          fingerprint,
        };
        const generationHistory = [...priorHistory, historyEntry].slice(-10);

        // Save columns (non-JSONB) separately from metadata (JSONB).
        // Columns use last-writer-wins which is safe; metadata uses the
        // atomic merge RPC to prevent concurrent writers clobbering each other.
        const columnPayload: Record<string, unknown> = {
          encounter_note: generatedNote,
        };
        // Retry transient fetch failures — see lib/supabase/retry.ts.
        const { error: columnError } = await retrySupabaseCall(
          () =>
            supabase
              .from("visits")
              .update(columnPayload)
              .eq("id", visitId) as unknown as Promise<{
              data: null;
              error: unknown;
            }>,
          { label: "regenerate-save-columns" },
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
          ...(doctorNotes ? { doctor_notes: doctorNotes } : {}),
          // Persist validated facts for future fact-based rerenders
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
                  suggestedIcdCodes: allCandidateIcdCodes,
                  problemClusters: finalAnalysis.problemClusters,
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

        // Log usage
        logUsage({
          userId,
          visitId,
          provider: "anthropic",
          model: usedModel,
          operation:
            operationType === "regenerate"
              ? "generate_template"
              : `${operationType}_template`,
          inputTokens,
          outputTokens,
        });

        // Send final complete event
        sendEvent({
          type: "complete",
          generatedNote,
          suggestedTitle,
          usedChunks: usedChunkIds,
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
                },
              }
            : {}),
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
