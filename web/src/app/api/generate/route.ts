import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { embedText } from "@/lib/openai";
import {
  generateFromTemplate,
  InsufficientContextError,
} from "@/lib/anthropic";
import { extractFileText } from "@/lib/extraction/extract-file";
import {
  DEFAULT_TEMPLATE_ID,
  buildSectionLabelsFromTemplate,
  buildSectionContextsFromTemplate,
} from "@/lib/templates";
import { resolveTemplate } from "@/lib/templates/server";
import { flattenSectionIds } from "@/lib/templates/html";
import { runClinicalAnalysis } from "@/lib/clinical";
import { logAudit, createAuditContext } from "@/lib/audit";
import { sendNoteEmail } from "@/lib/email/send-note-email";
import { createAdminClient } from "@/lib/supabase/admin";
import { filterEmptySectionsHtml } from "@/lib/parse-note-sections";
import type { ClinicalAnalysis } from "@/lib/clinical/types";
import type { SupportedLanguage, FileMetadata } from "@/lib/types";

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
    const doctorNotes: string | undefined = body.doctorNotes;
    // Scribe real-time transcript (used for recording files instead of Whisper)
    const transcriptText: string | undefined = body.transcriptText;
    const sendAsEmail: boolean = body.sendAsEmail === true;
    console.log("[generate] sendAsEmail:", sendAsEmail);

    console.log(
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

    // Fetch the visit to get its language and existing metadata (RLS enforces ownership)
    const { data: visit, error: visitError } = await supabase
      .from("visits")
      .select("id, title, language, metadata")
      .eq("id", visitId)
      .single();

    if (visitError || !visit) {
      return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    }

    const language = (visit.language as SupportedLanguage) || "en";

    // Process uploaded files — extract text from any that haven't been processed yet
    const visitMeta = (visit.metadata ?? {}) as Record<string, unknown>;
    let uploadedFiles = (visitMeta.files ?? []) as FileMetadata[];

    // Wait for any in-progress or pending extractions (with timeout)
    // Wait for any in-progress or pending extractions (poll until resolved)
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
      console.log(`[generate] Waiting for ${pendingIds.size} extraction(s)...`);
      const pollStart = Date.now();
      const MAX_WAIT = 60000;

      while (Date.now() - pollStart < MAX_WAIT) {
        await new Promise((resolve) => setTimeout(resolve, 500));
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
      console.log(
        `[generate] Extraction wait done (${Date.now() - pollStart}ms): ${completed}/${pendingIds.size} completed`,
      );
    }

    // Extract text from all unprocessed files — in parallel for speed
    const unprocessed = uploadedFiles.filter(
      (f) =>
        !f.extracted_text &&
        f.path &&
        f.extraction_status !== "extracting" && // Don't re-extract if extraction in progress
        f.extraction_status !== "pending", // Don't re-extract if pending background extraction
      // Note: Files marked "failed" or old "completed" with no text will be retried
    );
    const extractionErrors: string[] = [];

    if (unprocessed.length > 0) {
      const failed = unprocessed.filter(
        (f) => f.extraction_status === "failed",
      );
      const legacy = unprocessed.filter((f) => !f.extraction_status);
      console.log(
        `[generate] ${unprocessed.length} unprocessed file(s): ${failed.length} failed, ${legacy.length} legacy (no status)`,
      );
      lap("extraction-start");
      await Promise.all(
        unprocessed.map(async (file) => {
          const filePath = file.path!; // guaranteed by filter above
          try {
            const isAudio = file.type.startsWith("audio/");

            if (!isAudio) {
              // Images and PDFs: use shared extraction service
              try {
                const result = await extractFileText({
                  file: { ...file, path: filePath },
                  supabase,
                  userId,
                  visitId,
                  language,
                });
                file.extracted_text = result.text;
                console.log(
                  `[generate] Extracted ${result.text.length} chars from ${file.name} in ${result.elapsedMs}ms`,
                );
              } catch (extractError) {
                const msg =
                  extractError instanceof Error
                    ? extractError.message
                    : "Unknown extraction error";
                console.error(
                  `[generate] Extraction failed for ${file.name}:`,
                  extractError,
                );
                extractionErrors.push(`${file.name}: ${msg}`);
              }
            } else {
              // Audio: use shared extraction service (handles real-time transcript priority)
              try {
                const result = await extractFileText({
                  file: { ...file, path: filePath },
                  supabase,
                  userId,
                  visitId,
                  language,
                  transcriptText,
                });
                file.extracted_text = result.text;
                console.log(
                  `[generate] Extracted ${result.text.length} chars from ${file.name} in ${result.elapsedMs}ms`,
                );
              } catch (extractError) {
                const msg =
                  extractError instanceof Error
                    ? extractError.message
                    : "Unknown extraction error";
                console.error(
                  `[generate] Audio extraction failed for ${file.name}:`,
                  extractError,
                );
                extractionErrors.push(`${file.name}: ${msg}`);
              }
            }
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : "Unknown extraction error";
            console.error(`Text extraction failed for ${file.name}:`, err);
            extractionErrors.push(`${file.name}: ${msg}`);
          }
        }),
      );

      lap("extraction-done");

      // Set raw_text on visit from recording transcript (for ResourcesPanel)
      // NOTE: Do NOT update metadata.files here - the extract route already saved
      // extracted_text and extraction_status atomically. Writing the files array
      // here would overwrite those atomic updates with stale data.
      const recordingText = uploadedFiles.find(
        (f) => f.source === "recording" && f.extracted_text,
      )?.extracted_text;
      if (recordingText) {
        await supabase
          .from("visits")
          .update({ raw_text: recordingText })
          .eq("id", visitId);
      }
    }

    const fileTexts = uploadedFiles
      .filter((f) => f.extracted_text)
      .map((f) => ({ name: f.name, type: f.type, text: f.extracted_text! }));

    // If streaming transcript is provided but no recording file captured it
    // (e.g. file upload hasn't completed yet), inject it directly as content
    if (transcriptText && !fileTexts.some((f) => f.text === transcriptText)) {
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

    // Use transcriptText if available (real-time streaming), otherwise use chunk contents
    const transcriptChunks = transcriptText ? [transcriptText] : chunkContents;

    if (
      transcriptChunks.length === 0 &&
      !doctorNotes?.trim() &&
      !hasFileContent
    ) {
      if (extractionErrors.length > 0) {
        console.error(
          `[generate] File processing failed: ${extractionErrors.join("; ")}`,
        );
      }
      return NextResponse.json(
        { error: "insufficient_context" },
        { status: 422 },
      );
    }

    // Use two-pass generation (Haiku draft → Opus refinement)
    console.log(
      `[generate] Starting two-pass generation (${transcriptChunks.length} chunks, ${fileTexts.length} files)`,
    );

    // Use two-pass generation via generateFromTemplate
    lap("generation-start");

    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        let clientDisconnected = false;

        function sendEvent(data: Record<string, unknown>) {
          if (clientDisconnected) return;
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
            );
          } catch {
            clientDisconnected = true;
          }
        }

        function safeClose() {
          try {
            controller.close();
          } catch {
            /* already closed or cancelled */
          }
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

        // Notify client that generation is starting
        sendEvent({
          type: "streaming_start",
          sectionIds: allIds,
          sectionLabels,
        });

        try {
          // Call generateFromTemplate (handles two-pass internally)
          const { generatedNote, letter, suggestedTitle } =
            await generateFromTemplate(
              transcriptChunks,
              template,
              language,
              sectionLabels,
              doctorNotes,
              fileTexts,
              { userId, visitId },
              clinicalAnalysis ?? undefined,
              sectionContexts,
            );

          lap("generation-done");

          // Save to DB (must complete before sending complete event,
          // so the email API can read the latest encounter_note)
          // Use refreshedMetadata to preserve cached extracted_text from file processing
          // Auto-set title if the visit has none and AI suggested one
          const autoTitle =
            suggestedTitle && !visit.title ? suggestedTitle : undefined;

          const { error: saveError } = await supabase
            .from("visits")
            .update({
              encounter_note: generatedNote,
              patient_letter: letter,
              status: "to_review",
              ...(autoTitle ? { title: autoTitle } : {}),
              metadata: {
                ...refreshedMetadata,
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
            console.error("Failed to save generated content:", saveError);
            sendEvent({ type: "error", error: "save_failed" });
            safeClose();
            return;
          }

          // Note: Usage logging is handled inside generateFromTemplate for two-pass generation

          // Send final complete event and close stream so client gets response immediately
          sendEvent({
            type: "complete",
            generatedNote,
            letter,
            suggestedTitle,
            usedChunks,
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

          // Send email BEFORE closing stream — client already has the
          // "complete" event so there's no perceived delay. Sending after
          // safeClose() risks the runtime killing the function before the
          // email is dispatched.
          if (sendAsEmail) {
            try {
              const admin = createAdminClient();
              if (!admin) {
                throw new Error("Admin client unavailable");
              }
              // Use admin.getUserById instead of supabase.auth.getUser() —
              // during impersonation, supabase is a service-role client with no session.
              const { data: userData } =
                await admin.auth.admin.getUserById(userId);
              const userEmail = userData?.user?.email;
              if (userEmail) {
                const encounterPath = `/${language}/encounters/${visitId}`;
                const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
                const redirectTo = `${appUrl}${encounterPath}`;

                const { data: linkData } = await admin.auth.admin.generateLink({
                  type: "magiclink",
                  email: userEmail,
                  options: { redirectTo },
                });
                const viewUrl =
                  linkData?.properties?.action_link ||
                  `${appUrl}${encounterPath}`;

                await sendNoteEmail({
                  to: userEmail,
                  title: autoTitle || visit.title || "Untitled",
                  noteHtml: filterEmptySectionsHtml(generatedNote),
                  viewUrl,
                  language,
                });
                lap("email-sent");
              }
            } catch (err) {
              console.error("[email] Failed to send note email:", err);
            }
          }

          lap("total");
          safeClose();
        } catch (err) {
          console.error("Generate stream error:", err);

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
      },
      cancel() {
        // Client disconnected — generation continues in start()
        console.log(
          "[generate] Client disconnected, generation continues server-side",
        );
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
    if (err instanceof Response) return err;
    console.error("Generate route error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
