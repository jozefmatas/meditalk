import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { embedText } from "@/lib/openai";
import {
  generateFromTemplate,
  InsufficientContextError,
} from "@/lib/anthropic";
import { extractTextFromFile } from "@/lib/file-extraction";
import { getTemplateById, getDefaultTemplate } from "@/lib/templates";
import { flattenSectionIds } from "@/lib/templates/html";
import { runClinicalAnalysis } from "@/lib/clinical";
import type { ClinicalAnalysis } from "@/lib/clinical/types";
import type { GenerateResponse, SupportedLanguage } from "@/lib/types";

export const maxDuration = 300;

const RETRIEVAL_QUERY: Record<SupportedLanguage, string> = {
  en: "Patient symptoms, diagnosis, examination findings, treatment plan, medications, follow-up",
  sk: "Symptómy pacienta, diagnóza, vyšetrenie, plán liečby, lieky, kontrola",
  cs: "Symptomy pacienta, diagnóza, vyšetření, plán léčby, léky, kontrola",
};

export async function POST(request: NextRequest) {
  const t0 = Date.now();
  const lap = (label: string) =>
    console.log(`[generate] ${label} — ${Date.now() - t0}ms`);

  try {
    const { userId, supabase } = await requireAuth();
    lap("auth");

    const body = await request.json();
    // Support both visitId (new) and transcriptId (legacy)
    const visitId = body.visitId || body.transcriptId;
    const templateId: string | undefined = body.templateId;
    const doctorNotes: string | undefined = body.doctorNotes;
    // Scribe real-time transcript (used for recording files instead of Whisper)
    const transcriptText: string | undefined = body.transcriptText;

    console.log(
      `[generate] transcriptText: ${transcriptText ? `${transcriptText.length} chars` : "NONE"}`,
    );

    if (!visitId) {
      return NextResponse.json(
        { error: "Missing required field: visitId" },
        { status: 400 },
      );
    }

    // Fetch the visit to get its language and existing metadata (RLS enforces ownership)
    const { data: visit, error: visitError } = await supabase
      .from("visits")
      .select("id, language, metadata")
      .eq("id", visitId)
      .single();

    if (visitError || !visit) {
      return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    }

    const language = (visit.language as SupportedLanguage) || "en";

    // Process uploaded files — extract text from any that haven't been processed yet
    const visitMeta = (visit.metadata ?? {}) as Record<string, unknown>;
    const uploadedFiles = (visitMeta.files ?? []) as {
      id: string;
      name: string;
      type: string;
      path: string;
      source?: string;
      extracted_text?: string | null;
    }[];

    // Extract text from all unprocessed files — in parallel for speed
    const unprocessed = uploadedFiles.filter(
      (f) => !f.extracted_text && f.path,
    );
    console.log(
      `[generate] files: ${uploadedFiles.length} total, ${unprocessed.length} unprocessed`,
      uploadedFiles.map((f) => ({
        name: f.name,
        source: f.source,
        hasText: !!f.extracted_text,
      })),
    );

    if (unprocessed.length > 0) {
      lap("extraction-start");
      await Promise.all(
        unprocessed.map(async (file) => {
          // For recording files: use Scribe pre-transcript if available (instant)
          if (file.source === "recording" && transcriptText) {
            file.extracted_text = transcriptText;
            return;
          }

          try {
            const { data: fileData, error: dlError } = await supabase.storage
              .from("encounter-files")
              .download(file.path);

            if (dlError || !fileData) {
              console.error(`Failed to download ${file.name}:`, dlError);
              return;
            }

            const buffer = Buffer.from(await fileData.arrayBuffer());
            const text = await extractTextFromFile(
              buffer,
              file.name,
              file.type,
              language,
              { userId, visitId },
            );
            file.extracted_text = text;
          } catch (err) {
            console.error(`Text extraction failed for ${file.name}:`, err);
          }
        }),
      );

      lap("extraction-done");

      // Cleanup: delete all processed files from storage (text already extracted)
      const pathsToDelete = uploadedFiles
        .filter((f) => f.extracted_text && f.path)
        .map((f) => f.path);
      if (pathsToDelete.length > 0) {
        await supabase.storage
          .from("encounter-files")
          .remove(pathsToDelete)
          .catch(() => {});
        for (const f of uploadedFiles) {
          if (f.extracted_text) f.path = "";
        }
      }

      // Set raw_text on visit from recording transcript (for ResourcesPanel)
      const recordingText = uploadedFiles.find(
        (f) => f.source === "recording" && f.extracted_text,
      )?.extracted_text;
      if (recordingText) {
        await supabase
          .from("visits")
          .update({
            raw_text: recordingText,
            metadata: { ...visitMeta, files: uploadedFiles },
          })
          .eq("id", visitId);
      } else {
        // Persist extracted text + cleared paths back to metadata
        await supabase
          .from("visits")
          .update({ metadata: { ...visitMeta, files: uploadedFiles } })
          .eq("id", visitId);
      }
    }

    const fileTexts = uploadedFiles
      .filter((f) => f.extracted_text)
      .map((f) => ({ name: f.name, type: f.type, text: f.extracted_text! }));

    // If streaming transcript is provided but no recording file captured it
    // (e.g. file upload hasn't completed yet), inject it directly as content
    if (
      transcriptText &&
      !fileTexts.some((f) => f.text === transcriptText)
    ) {
      fileTexts.push({
        name: "recording-transcript",
        type: "text/plain",
        text: transcriptText,
      });

      // Also persist raw_text for ResourcesPanel
      await supabase
        .from("visits")
        .update({ raw_text: transcriptText })
        .eq("id", visitId);
    }

    // Look up the template
    const template =
      (templateId ? getTemplateById(templateId) : null) || getDefaultTemplate();

    // Load section labels from locale messages
    const messages = (await import(`../../../../messages/${language}.json`))
      .default;
    const templateSections: Record<string, string> =
      messages.templates?.sections || {};
    const allIds = flattenSectionIds(template);
    const sectionLabels: Record<string, string> = {};
    for (const id of allIds) {
      sectionLabels[id] = templateSections[id] || id;
    }

    // Semantic search on legacy transcript chunks + clinical analysis — run in parallel
    let chunkContents: string[] = [];
    let usedChunks: string[] = [];
    const hasFileContent = fileTexts.length > 0;

    // Build clinical input from all extracted text + doctor notes
    const clinicalInputParts: string[] = [];
    for (const ft of fileTexts) {
      clinicalInputParts.push(`[File: ${ft.name}]\n${ft.text}`);
    }
    if (doctorNotes?.trim()) {
      clinicalInputParts.push(`[Doctor Notes]\n${doctorNotes}`);
    }

    // Run embedding search and clinical analysis in parallel
    // Skip embedding entirely when transcriptText is provided (modern Scribe flow)
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

          const queryEmbedding = await embedText(RETRIEVAL_QUERY[language], {
            userId,
            visitId,
          });

          const { data: matches, error: rpcError } = await supabase.rpc(
            "match_chunks",
            {
              query_embedding: JSON.stringify(queryEmbedding),
              match_count: 16,
              p_visit_id: visitId,
            },
          );

          if (rpcError) {
            console.error("match_chunks RPC error:", rpcError);
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

    const clinicalPromise: Promise<ClinicalAnalysis | null> =
      clinicalInputParts.length > 0
        ? runClinicalAnalysis(clinicalInputParts, language, { userId, visitId })
            .then((result) => {
              console.log(
                "Clinical analysis complete — specialty:",
                result.inferredSpecialty,
                "concepts:",
                result.matchedConcepts.length,
                "ICD codes:",
                result.candidateIcdCodes.length,
              );
              return result;
            })
            .catch((err) => {
              console.warn(
                "Clinical analysis failed, proceeding without enrichment:",
                err,
              );
              return null;
            })
        : Promise.resolve(null);

    const [embeddingResult, clinicalAnalysis] = await Promise.all([
      embeddingPromise,
      clinicalPromise,
    ]);

    lap("parallel-done");
    chunkContents = embeddingResult.chunkContents;
    usedChunks = embeddingResult.usedChunks;

    // Add chunk contents to clinical input (for generation, not re-analysis)
    if (chunkContents.length > 0) {
      clinicalInputParts.unshift(...chunkContents);
    }

    if (chunkContents.length === 0 && !doctorNotes?.trim() && !hasFileContent) {
      return NextResponse.json(
        {
          error:
            "No transcript, doctor notes, or file content available for generation",
        },
        { status: 404 },
      );
    }

    // Pass 2: Generate note from template (enriched with clinical analysis)
    lap("generation-start");
    let generatedNote: string;
    let letter: string;
    let suggestedTitle: string;
    try {
      const result = await generateFromTemplate(
        chunkContents,
        template,
        language,
        sectionLabels,
        doctorNotes,
        fileTexts,
        { userId, visitId },
        clinicalAnalysis ?? undefined,
      );
      generatedNote = result.generatedNote;
      letter = result.letter;
      suggestedTitle = result.suggestedTitle;
      lap("generation-done");
    } catch (anthropicErr) {
      if (anthropicErr instanceof InsufficientContextError) {
        return NextResponse.json(
          {
            error: "insufficient_context",
          },
          { status: 422 },
        );
      }
      console.error("Anthropic generation failed:", anthropicErr);
      return NextResponse.json(
        {
          error: `Generation failed: ${anthropicErr instanceof Error ? anthropicErr.message : String(anthropicErr)}`,
        },
        { status: 500 },
      );
    }

    // Save generated content to the visit (preserve existing metadata)
    const existingMetadata = (visit.metadata as Record<string, unknown>) || {};
    const { error: updateError } = await supabase
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

    if (updateError) {
      console.error("Failed to save generated content:", updateError);
    }

    const response: GenerateResponse = {
      generatedNote,
      letter,
      suggestedTitle: suggestedTitle || undefined,
      usedChunks,
      templateId: template.id,
      soap: generatedNote,
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
    };

    lap("total");
    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Generate route error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
