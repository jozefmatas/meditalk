import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import {
  anthropic,
  GENERATION_MODEL,
  buildTemplateSystemPrompt,
  buildTemplateUserMessage,
} from "@/lib/anthropic";
import { getTemplateById, getDefaultTemplate } from "@/lib/templates";
import { buildTemplateHtml, flattenSectionIds } from "@/lib/templates/html";
import { logUsage } from "@/lib/usage";
import {
  runClinicalAnalysis,
  buildEnrichedSystemPrompt,
  extractJson,
} from "@/lib/clinical";
import type { ClinicalAnalysis } from "@/lib/clinical/types";
import type { SupportedLanguage } from "@/lib/types";
import { parseNoteToSectionMap } from "@/lib/parse-note-sections";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
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

  try {
    const auth = await requireAuth();
    userId = auth.userId;
    supabase = auth.supabase;
  } catch (err) {
    if (err instanceof Response) return err;
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await request.json();
    const visitId: string | undefined = body.visitId;
    const templateId: string | undefined = body.templateId;
    const doctorNotes: string | undefined = body.doctorNotes;

    if (!visitId) {
      return new Response(JSON.stringify({ error: "Missing visitId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch visit metadata (RLS enforces ownership)
    const { data: visit, error: visitError } = await supabase
      .from("visits")
      .select("id, language, metadata, soap_note, patient_letter")
      .eq("id", visitId)
      .single();

    if (visitError || !visit) {
      return new Response(JSON.stringify({ error: "Visit not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const language =
      ((visit.language as string)?.trim() as SupportedLanguage) || "en";

    // Fetch chunks directly by visit_id — skip embedding + vector search
    const { data: chunks, error: chunksError } = await supabase
      .from("transcript_chunks")
      .select("id, content")
      .eq("visit_id", visitId)
      .order("chunk_index", { ascending: true });

    // Collect already-extracted file texts from metadata
    const visitMeta = (visit.metadata ?? {}) as Record<string, unknown>;
    const uploadedFiles = (visitMeta.files ?? []) as {
      name: string;
      type: string;
      extracted_text?: string | null;
    }[];
    const fileTexts = uploadedFiles
      .filter((f) => f.extracted_text)
      .map((f) => ({ name: f.name, type: f.type, text: f.extracted_text! }));

    const chunkContents = chunks?.map((c) => c.content) ?? [];
    const usedChunkIds = chunks?.map((c) => c.id as string) ?? [];

    if (
      chunkContents.length === 0 &&
      !doctorNotes?.trim() &&
      fileTexts.length === 0
    ) {
      return new Response(
        JSON.stringify({
          error: "No transcript, doctor notes, or file content available",
        }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    if (chunksError) {
      console.error("Chunk fetch error:", chunksError);
    }

    // Resolve template
    const template =
      (templateId ? getTemplateById(templateId) : null) || getDefaultTemplate();
    const allIds = flattenSectionIds(template);

    // Load section labels from locale messages
    const messages = (await import(`../../../../messages/${language}.json`))
      .default;
    const templateSections: Record<string, string> =
      messages.templates?.sections || {};
    const sectionLabels: Record<string, string> = {};
    for (const id of allIds) {
      sectionLabels[id] = templateSections[id] || id;
    }

    // Determine generation path: fast reformat vs full generation
    const existingNote = visit.soap_note as string | null;
    const oldTemplateId = (visitMeta.template_id as string) || null;
    const oldTemplate = oldTemplateId ? getTemplateById(oldTemplateId) : null;

    let clinicalAnalysis: ClinicalAnalysis | null = null;
    const cachedAnalysis = visitMeta.clinical_analysis as
      | Record<string, unknown>
      | undefined;

    let streamModel: string;
    let systemPrompt: string;
    let userMessage: string;
    let reuseLetterFromVisit = false;

    if (existingNote && oldTemplate && oldTemplateId !== template.id) {
      // ─── FAST PATH: Reformat existing note with Haiku ───
      const sectionMap = parseNoteToSectionMap(existingNote, oldTemplate);
      reuseLetterFromVisit = true;

      const currentSections = Object.entries(sectionMap)
        .filter(([, content]) => content.trim())
        .map(([id, content]) => `[${id}]: ${content}`)
        .join("\n\n");

      const langLabel = LANGUAGE_LABELS[language];
      const sectionList = allIds
        .map((id) => `- "${id}": ${sectionLabels[id] || id}`)
        .join("\n");

      streamModel = HAIKU_MODEL;

      systemPrompt = `You reorganize medical documentation between template formats.
Rules:
1. Preserve ALL clinical information. Do not omit any details from the source.
2. Preserve the EXACT tone, voice, and writing style of the original note. Do not rephrase, simplify, or embellish — copy the wording verbatim where it fits and only restructure when necessary to fit a different section.
3. Write in ${langLabel}, except medical terms.
4. Sections with no relevant content: use empty string "".
5. Return valid JSON with keys: ${allIds.map((id) => `"${id}"`).join(", ")}`;

      userMessage = `CURRENT NOTE SECTIONS:\n\n${currentSections}\n\nReorganize into these target template sections:\n${sectionList}\n\nReturn valid JSON.`;

      // Load cached analysis for the SSE event (not used in prompt)
      if (cachedAnalysis?.inferredSpecialty) {
        clinicalAnalysis = {
          ...cachedAnalysis,
          usage: { inputTokens: 0, outputTokens: 0 },
        } as ClinicalAnalysis;
      }
    } else {
      // ─── FULL PATH: Generate from transcript with Opus ───
      streamModel = GENERATION_MODEL;

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
          console.warn(
            "Clinical analysis failed, proceeding without enrichment:",
            analysisErr,
          );
        }
      }

      const baseSystemPrompt = buildTemplateSystemPrompt(
        template,
        language,
        sectionLabels,
      );
      systemPrompt = clinicalAnalysis
        ? buildEnrichedSystemPrompt(baseSystemPrompt, clinicalAnalysis)
        : baseSystemPrompt;
      userMessage = buildTemplateUserMessage(
        chunkContents,
        template,
        doctorNotes,
        fileTexts,
      );
    }

    // Stream Anthropic response as SSE (with retry on overloaded errors)
    const STREAM_MAX_RETRIES = 3;
    const STREAM_RETRY_DELAYS = [2000, 5000, 10000];

    const encoder = new TextEncoder();
    const sectionIdSet = new Set(allIds);

    const readable = new ReadableStream({
      async start(controller) {
        let inputTokens = 0;
        let outputTokens = 0;

        function sendEvent(data: Record<string, unknown>) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        }

        // Notify client that clinical analysis is complete
        if (clinicalAnalysis) {
          sendEvent({
            type: "analysis_complete",
            specialty: clinicalAnalysis.inferredSpecialty,
            icdCodeCount: clinicalAnalysis.candidateIcdCodes.length,
            conceptCount: clinicalAnalysis.matchedConcepts.length,
          });
        }

        /**
         * Try to extract completed "key": "value" pairs from the accumulated JSON.
         * Emits SSE events for each newly completed template section.
         */
        function tryExtractSections(
          accumulated: string,
          emittedSections: Set<string>,
        ) {
          for (const id of sectionIdSet) {
            if (emittedSections.has(id)) continue;

            const keyPattern = `"${id}"\\s*:\\s*"`;
            const keyMatch = accumulated.match(new RegExp(keyPattern));
            if (!keyMatch) continue;

            const valueStart = keyMatch.index! + keyMatch[0].length;
            let pos = valueStart;
            let found = false;
            while (pos < accumulated.length) {
              if (accumulated[pos] === "\\") {
                pos += 2;
                continue;
              }
              if (accumulated[pos] === '"') {
                found = true;
                break;
              }
              pos++;
            }

            if (!found) continue;

            const rawValue = accumulated.slice(valueStart, pos);
            let value: string;
            try {
              value = JSON.parse(`"${rawValue}"`);
            } catch {
              value = rawValue;
            }

            emittedSections.add(id);
            sendEvent({
              type: "section",
              id,
              title: sectionLabels[id] || id,
              content: value,
            });
          }
        }

        let finalMessage: Awaited<
          ReturnType<
            ReturnType<typeof anthropic>["messages"]["stream"]
          >["finalMessage"]
        >;

        for (let attempt = 0; attempt <= STREAM_MAX_RETRIES; attempt++) {
          sendEvent({
            type: "streaming_start",
            sectionIds: allIds,
            sectionLabels,
          });

          let accumulated = "";
          const emittedSections = new Set<string>();

          try {
            const stream = anthropic().messages.stream({
              model: streamModel,
              max_tokens: 8192,
              system: systemPrompt,
              messages: [{ role: "user", content: userMessage }],
            });

            stream.on("text", (delta) => {
              accumulated += delta;
              tryExtractSections(accumulated, emittedSections);
            });

            finalMessage = await stream.finalMessage();
            break; // Success
          } catch (err) {
            const isOverloaded =
              err instanceof Error &&
              err.message.toLowerCase().includes("overloaded");
            if (isOverloaded && attempt < STREAM_MAX_RETRIES) {
              const delay = STREAM_RETRY_DELAYS[attempt];
              console.warn(
                `[regenerate] Overloaded, retrying in ${delay}ms (attempt ${attempt + 1}/${STREAM_MAX_RETRIES})`,
              );
              await new Promise((r) => setTimeout(r, delay));
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
            controller.close();
            return;
          }

          let letter: string;
          let suggestedTitle: string;

          if (reuseLetterFromVisit) {
            // Reformat path — keep existing letter and title
            letter = (visit.patient_letter as string) || "";
            suggestedTitle = "";
            delete parsed.letter;
            delete parsed.title;
          } else {
            letter =
              typeof parsed.letter === "string"
                ? parsed.letter
                : JSON.stringify(parsed.letter || "");
            delete parsed.letter;
            suggestedTitle =
              typeof parsed.title === "string" ? parsed.title : "";
            delete parsed.title;
          }

          const sectionContents: Record<string, string> = {};
          for (const id of allIds) {
            const value = parsed[id];
            sectionContents[id] = typeof value === "string" ? value : "";
          }

          const generatedNote = buildTemplateHtml(
            template,
            sectionContents,
            sectionLabels,
          );

          // Save to DB (must complete before sending complete event,
          // so the email API can read the latest soap_note)
          const existingMetadata =
            (visit.metadata as Record<string, unknown>) || {};
          const { error: saveError } = await supabase
            .from("visits")
            .update({
              soap_note: generatedNote,
              patient_letter: letter,
              metadata: {
                ...existingMetadata,
                template_id: template.id,
                ...(doctorNotes ? { doctor_notes: doctorNotes } : {}),
                ...(clinicalAnalysis
                  ? {
                      clinical_analysis: {
                        inferredSpecialty: clinicalAnalysis.inferredSpecialty,
                        secondarySpecialty: clinicalAnalysis.secondarySpecialty,
                        matchedConcepts: clinicalAnalysis.matchedConcepts,
                        candidateIcdCodes: clinicalAnalysis.candidateIcdCodes,
                        problemClusters: clinicalAnalysis.problemClusters,
                      },
                    }
                  : {}),
              },
            })
            .eq("id", visitId);
          if (saveError) {
            console.error("Failed to save regenerated content:", saveError);
          }

          // Log usage
          logUsage({
            userId,
            visitId,
            provider: "anthropic",
            model: streamModel,
            operation: reuseLetterFromVisit
              ? "reformat_template"
              : "generate_template",
            inputTokens,
            outputTokens,
          });

          // Send final complete event
          sendEvent({
            type: "complete",
            generatedNote,
            letter,
            suggestedTitle,
            usedChunks: usedChunkIds,
            templateId: template.id,
            ...(clinicalAnalysis
              ? {
                  clinicalAnalysis: {
                    inferredSpecialty: clinicalAnalysis.inferredSpecialty,
                    secondarySpecialty: clinicalAnalysis.secondarySpecialty,
                    candidateIcdCodes: clinicalAnalysis.candidateIcdCodes,
                    matchedConcepts: clinicalAnalysis.matchedConcepts,
                    problemClusters: clinicalAnalysis.problemClusters,
                  },
                }
              : {}),
          });

          controller.close();
        } catch (err) {
          console.error("Regenerate stream error:", err);
          sendEvent({
            type: "error",
            error: err instanceof Error ? err.message : "Generation failed",
          });
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("Regenerate route error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
