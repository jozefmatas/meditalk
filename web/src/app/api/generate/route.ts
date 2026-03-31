import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { embedText } from "@/lib/openai";
import {
  anthropic,
  GENERATION_MODELS,
  MODEL_FALLBACK_DELAY,
  buildTemplateSystemPrompt,
  buildTemplateUserMessage,
} from "@/lib/anthropic";
import { extractTextFromFile } from "@/lib/file-extraction";
import {
  DEFAULT_TEMPLATE_ID,
  buildSectionLabelsFromTemplate,
  buildSectionContextsFromTemplate,
} from "@/lib/templates";
import { resolveTemplate } from "@/lib/templates/server";
import { buildTemplateHtml, flattenSectionIds } from "@/lib/templates/html";
import { runClinicalAnalysis } from "@/lib/clinical";
import { buildEnrichedSystemPrompt, extractJson } from "@/lib/clinical";
import { logUsage } from "@/lib/usage";
import { logAudit, createAuditContext } from "@/lib/audit";
import { sendNoteEmail } from "@/lib/email/send-note-email";
import { createAdminClient } from "@/lib/supabase/admin";
import { filterEmptySectionsHtml } from "@/lib/parse-note-sections";
import type { ClinicalAnalysis } from "@/lib/clinical/types";
import type { SupportedLanguage } from "@/lib/types";

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
    const extractionErrors: string[] = [];
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
          try {
            const isImage = file.type.startsWith("image/");
            const isPdf = file.type === "application/pdf";
            const isAudio = file.type.startsWith("audio/");

            if (isImage) {
              // Download image so we can auto-rotate EXIF orientation with sharp
              // before sending to Claude Vision (phone photos are often rotated)
              const { data: fileData, error: dlError } = await supabase.storage
                .from("encounter-files")
                .download(file.path);

              if (dlError || !fileData) {
                console.error(`Failed to download ${file.name}:`, dlError);
                extractionErrors.push(`${file.name}: download failed`);
                return;
              }

              const buffer = Buffer.from(await fileData.arrayBuffer());
              const text = await extractTextFromFile(
                { imageBuffer: buffer },
                file.name,
                file.type,
                language,
                { userId, visitId },
              );
              file.extracted_text = text;
            } else if (isPdf) {
              // PDFs: use signed URL so Claude fetches directly (no rotation issue)
              const { data: urlData, error: urlError } = await supabase.storage
                .from("encounter-files")
                .createSignedUrl(file.path, 300); // 5 min expiry

              if (urlError || !urlData?.signedUrl) {
                console.error(
                  `Failed to create signed URL for ${file.name}:`,
                  urlError,
                );
                extractionErrors.push(`${file.name}: signed URL failed`);
                return;
              }

              const text = await extractTextFromFile(
                { pdfUrl: urlData.signedUrl },
                file.name,
                file.type,
                language,
                { userId, visitId },
              );
              file.extracted_text = text;
            } else if (isAudio) {
              // Audio: download, anonymize (if recording), then use transcript or transcribe
              const { data: fileData, error: dlError } = await supabase.storage
                .from("encounter-files")
                .download(file.path);

              if (dlError || !fileData) {
                console.error(`Failed to download ${file.name}:`, dlError);
                extractionErrors.push(`${file.name}: download failed`);
                return;
              }

              const buffer = Buffer.from(await fileData.arrayBuffer());

              // Check if anonymization is enabled and if this is a recording
              const enableAnonymization =
                process.env.ENABLE_AUDIO_ANONYMIZATION !== "false"; // Default: true
              const isRecording = file.source === "recording";

              // ALWAYS anonymize recordings (privacy first!), even if we have transcriptText
              if (enableAnonymization && isRecording) {
                // Server-side anonymization pipeline
                const crypto = await import("crypto");
                const fs = await import("fs/promises");
                const {
                  anonymizeAudio,
                  cleanupTempFiles,
                  checkFfmpegAvailable,
                } = await import("@/lib/server/audio-anonymization");

                // Check if ffmpeg is available
                const ffmpegAvailable = await checkFfmpegAvailable();

                if (!ffmpegAvailable) {
                  console.warn(
                    "[generate] ffmpeg not available - skipping anonymization",
                  );

                  // Check if we have real-time transcript first (fast!)
                  if (transcriptText) {
                    console.log(
                      `[generate] Using real-time transcript (${transcriptText.length} chars) - skipping transcription`,
                    );
                    file.extracted_text = transcriptText;
                    return;
                  }

                  // Fallback: transcribe original if no real-time transcript
                  console.log(
                    "[generate] No real-time transcript, transcribing original audio",
                  );
                  const text = await extractTextFromFile(
                    { buffer },
                    file.name,
                    file.type,
                    language,
                    { userId, visitId },
                  );
                  file.extracted_text = text;
                  return;
                }

                const tempOriginal = `/tmp/${crypto.randomUUID()}.webm`;
                const startTime = Date.now();

                try {
                  // Write original to temp file
                  await fs.writeFile(tempOriginal, buffer);

                  // Anonymize
                  console.log(
                    `[generate] Anonymizing ${file.name} (${buffer.length} bytes)`,
                  );
                  const tempAnonymized = await anonymizeAudio(
                    tempOriginal,
                    userId,
                  );
                  const anonymizedBuffer = await fs.readFile(tempAnonymized);

                  // Delete original temp file IMMEDIATELY
                  await fs.unlink(tempOriginal);

                  logAudit({
                    ...createAuditContext(authResult, request),
                    action: "audio.original.deleted",
                    resourceType: "encounter_file",
                    resourceId: file.id,
                    metadata: {
                      path: tempOriginal,
                      visitId,
                      processingTimeMs: Date.now() - startTime,
                    },
                  });

                  console.log(
                    `[generate] Anonymization complete (${anonymizedBuffer.length} bytes)`,
                  );

                  // Use real-time transcript if available (fast!), otherwise transcribe
                  let text: string | null = null;
                  if (transcriptText) {
                    console.log(
                      `[generate] Using real-time transcript (${transcriptText.length} chars)`,
                    );
                    text = transcriptText;
                  } else {
                    console.log(
                      "[generate] No real-time transcript, transcribing anonymized audio",
                    );
                    text = await extractTextFromFile(
                      { buffer: anonymizedBuffer },
                      file.name.replace(/\.[^.]+$/, ".opus"),
                      "audio/opus",
                      language,
                      { userId, visitId },
                    );
                  }

                  file.extracted_text = text;

                  // Text extraction successful → delete anonymized temp file
                  await fs.unlink(tempAnonymized);

                  // Delete from storage too (don't keep ANY audio!)
                  await supabase.storage
                    .from("encounter-files")
                    .remove([file.path]);

                  file.path = ""; // Clear path since file is deleted

                  logAudit({
                    ...createAuditContext(authResult, request),
                    action: "audio.anonymized.deleted",
                    resourceType: "encounter_file",
                    resourceId: file.id,
                    metadata: {
                      reason: transcriptText
                        ? "realtime_transcript_used"
                        : "transcription_successful",
                      path: file.path,
                      visitId,
                      transcriptLength: text?.length || 0,
                      usedRealtimeTranscript: !!transcriptText,
                      processingTimeMs: Date.now() - startTime,
                    },
                  });

                  logAudit({
                    ...createAuditContext(authResult, request),
                    action: "audio.anonymization.complete",
                    resourceType: "encounter_file",
                    resourceId: file.id,
                    metadata: {
                      originalSize: buffer.length,
                      anonymizedSize: anonymizedBuffer.length,
                      usedRealtimeTranscript: !!transcriptText,
                      processingTimeMs: Date.now() - startTime,
                      visitId,
                    },
                  });
                } catch (error) {
                  console.error(
                    "[generate] Audio anonymization failed:",
                    error,
                  );

                  // Cleanup temp files
                  await cleanupTempFiles(tempOriginal);

                  // On error: save anonymized to storage for retry (if it exists)
                  const tempAnonymized = tempOriginal.replace(
                    /\.[^.]+$/,
                    ".anonymized.opus",
                  );
                  try {
                    await fs.access(tempAnonymized);
                    const anonymizedBuffer = await fs.readFile(tempAnonymized);

                    await supabase.storage
                      .from("encounter-files")
                      .upload(file.path, anonymizedBuffer, { upsert: true });

                    await fs.unlink(tempAnonymized);

                    logAudit({
                      ...createAuditContext(authResult, request),
                      action: "audio.anonymized.saved_for_retry",
                      resourceType: "encounter_file",
                      resourceId: file.id,
                      metadata: {
                        reason: "transcription_failed",
                        error:
                          error instanceof Error
                            ? error.message
                            : "unknown error",
                        visitId,
                      },
                    });
                  } catch {
                    // Anonymized file doesn't exist, continue with fallback
                  }

                  // Fallback: transcribe original if anonymization fails
                  const fallbackEnabled =
                    process.env.ANONYMIZATION_FALLBACK_ENABLED !== "false";
                  if (fallbackEnabled) {
                    console.warn("[generate] Using original audio as fallback");
                    const text = await extractTextFromFile(
                      { buffer },
                      file.name,
                      file.type,
                      language,
                      { userId, visitId },
                    );
                    file.extracted_text = text;

                    logAudit({
                      ...createAuditContext(authResult, request),
                      action: "audio.anonymization.failed",
                      resourceType: "encounter_file",
                      resourceId: file.id,
                      metadata: {
                        error:
                          error instanceof Error
                            ? error.message
                            : "unknown error",
                        fallbackUsed: true,
                        visitId,
                      },
                    });
                  } else {
                    // Re-throw error if fallback disabled
                    throw error;
                  }
                }
              } else {
                // Anonymization disabled or not a recording
                // Check if we have real-time transcript first (fast!)
                if (transcriptText && isRecording) {
                  console.log(
                    `[generate] Using real-time transcript (${transcriptText.length} chars) - skipping transcription`,
                  );
                  file.extracted_text = transcriptText;
                } else {
                  // Fallback: transcribe original
                  const text = await extractTextFromFile(
                    { buffer },
                    file.name,
                    file.type,
                    language,
                    { userId, visitId },
                  );
                  file.extracted_text = text;
                }
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
      const error =
        extractionErrors.length > 0
          ? `File processing failed: ${extractionErrors.join("; ")}`
          : "No transcript, doctor notes, or file content available for generation";
      return NextResponse.json({ error }, { status: 422 });
    }

    // Build prompts for streaming generation
    let systemPrompt = buildTemplateSystemPrompt(
      template,
      language,
      sectionLabels,
      sectionContexts,
    );
    if (clinicalAnalysis) {
      systemPrompt = buildEnrichedSystemPrompt(
        systemPrompt,
        clinicalAnalysis,
        language,
      );
    }

    const userMessage = buildTemplateUserMessage(
      transcriptChunks,
      template,
      doctorNotes,
      fileTexts,
    );

    console.log(
      `[generate] prompt sizes — system: ${systemPrompt.length} chars, user: ${userMessage.length} chars`,
    );

    // Stream Anthropic response as SSE (with model fallback on overloaded errors)
    lap("generation-start");

    const encoder = new TextEncoder();
    const sectionIdSet = new Set(allIds);

    const readable = new ReadableStream({
      async start(controller) {
        let inputTokens = 0;
        let outputTokens = 0;
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
        let usedModel: string = GENERATION_MODELS[0];

        // Try each model in the fallback chain; on overload, move to the next model
        for (let mi = 0; mi < GENERATION_MODELS.length; mi++) {
          const model = GENERATION_MODELS[mi];

          // Send streaming_start on each attempt so client resets streamed sections
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
              system: systemPrompt,
              messages: [{ role: "user", content: userMessage }],
            });

            stream.on("text", (delta) => {
              accumulated += delta;
              tryExtractSections(accumulated, emittedSections);
            });

            finalMessage = await stream.finalMessage();
            usedModel = model;
            break; // Success
          } catch (err) {
            const isOverloaded =
              err instanceof Error &&
              err.message.toLowerCase().includes("overloaded");
            if (isOverloaded && mi < GENERATION_MODELS.length - 1) {
              console.warn(
                `[generate] ${model} overloaded, falling back to ${GENERATION_MODELS[mi + 1]} in ${MODEL_FALLBACK_DELAY}ms`,
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

          lap("generation-done");
          console.log(
            `[generate] Anthropic usage — input: ${inputTokens}, output: ${outputTokens}, stop: ${finalMessage!.stop_reason}`,
          );

          // Parse the full JSON for the final result
          const fullText =
            finalMessage!.content[0].type === "text"
              ? finalMessage!.content[0].text
              : "";

          // Check for insufficient context
          if (fullText.includes('"insufficient_context"')) {
            try {
              const rawParsed = extractJson<Record<string, unknown>>(fullText);
              if (rawParsed.insufficient_context === true) {
                sendEvent({ type: "error", error: "insufficient_context" });
                safeClose();
                return;
              }
            } catch {
              // Continue with normal parsing
            }
          }

          let parsed: Record<string, string>;
          try {
            parsed = extractJson<Record<string, string>>(fullText);
          } catch {
            sendEvent({ type: "error", error: "Failed to parse response" });
            safeClose();
            return;
          }

          // Extract letter and title
          const letter =
            typeof parsed.letter === "string"
              ? parsed.letter
              : JSON.stringify(parsed.letter || "");
          delete parsed.letter;

          const suggestedTitle =
            typeof parsed.title === "string" ? parsed.title : "";
          delete parsed.title;

          // Fill section contents (empty string for missing keys)
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
          // so the email API can read the latest encounter_note)
          const existingMetadata =
            (visit.metadata as Record<string, unknown>) || {};
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
            console.error("Failed to save generated content:", saveError);
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
            operation: "generate_template",
            inputTokens,
            outputTokens,
          });

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
