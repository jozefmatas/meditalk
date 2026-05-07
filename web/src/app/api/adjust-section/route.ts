import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "@/lib/supabase/auth";
import { logAudit, createAuditContext } from "@/lib/audit";
import { logUsage } from "@/lib/usage";
import { logger } from "@/lib/logger";
import { getTranscript } from "@/lib/encounters/sources";

export const maxDuration = 300;

let _anthropic: Anthropic | null = null;
function anthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ maxRetries: 4 });
  return _anthropic;
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
    const {
      visitId,
      sectionId,
      currentContent,
      feedbackText,
      subsections,
      subsectionLabels,
      otherSectionContents,
      sectionLabels,
    } = body;

    // Validate required fields
    if (!visitId || !sectionId || !feedbackText) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    // Either currentContent (single section) OR subsections (parent section) must be present
    const isSingleSection =
      currentContent !== undefined && typeof currentContent === "string";
    const isParentSection =
      subsections !== undefined &&
      typeof subsections === "object" &&
      subsections !== null &&
      !Array.isArray(subsections);

    if (!isSingleSection && !isParentSection) {
      return NextResponse.json(
        {
          error:
            "Either currentContent (string) or subsections (object) is required",
        },
        { status: 400 },
      );
    }

    logAudit({
      ...createAuditContext(authResult, request),
      action: "encounter.adjust_section",
      resourceType: "encounter",
      resourceId: visitId,
      metadata: { sectionId },
    });

    // Fetch visit with sources
    const { data: visit, error: visitError } = await supabase
      .from("visits")
      .select("id, user_id, metadata")
      .eq("id", visitId)
      .single();

    if (visitError || !visit) {
      logger.error("[adjust-section] Visit not found:", {
        visitId,
        userId,
        error: visitError,
      });
      return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    }

    // Gather sources for context
    const metadata = (visit.metadata as Record<string, unknown>) || {};
    const transcript = getTranscript(metadata);
    const doctorNotes = (metadata.doctor_notes as string) || "";
    const uploadedContext = (metadata.uploaded_files_context as string) || "";

    // Build sources section
    let sourcesSection = "";
    if (transcript) {
      sourcesSection += `**Consultation Transcript:**\n${transcript}\n\n`;
    }
    if (doctorNotes) {
      sourcesSection += `**Doctor's Notes:**\n${doctorNotes}\n\n`;
    }
    if (uploadedContext) {
      sourcesSection += `**Uploaded Files Context:**\n${uploadedContext}\n\n`;
    }

    // Build context from other sections of the note (lab results, findings, etc.)
    let noteContext = "";
    if (
      otherSectionContents &&
      typeof otherSectionContents === "object" &&
      Object.keys(otherSectionContents).length > 0
    ) {
      const entries = Object.entries(
        otherSectionContents as Record<string, string>,
      )
        .filter(([, content]) => content?.trim())
        .map(([id, content]) => {
          const label = sectionLabels?.[id] || id;
          return `### ${label}\n${content}`;
        })
        .join("\n\n");
      if (entries) {
        noteContext = `**OTHER SECTIONS OF THE NOTE** (for reference — do NOT modify these):\n${entries}\n\n`;
      }
    }

    // Handle parent section regeneration
    if (isParentSection) {
      logger.info(
        `[adjust-section] Adjusting parent section ${sectionId} for visit ${visitId}`,
        {
          sectionId,
          subsectionCount: Object.keys(subsections).length,
          subsectionIds: Object.keys(subsections),
          feedbackLength: feedbackText.length,
        },
      );

      // Build subsections list for prompt with labels
      const subsectionsList = Object.entries(subsections)
        .map(([id, content]) => {
          const label = subsectionLabels?.[id] || id;
          return `### ${label} (ID: ${id})\n${content || "(empty)"}`;
        })
        .join("\n\n");

      logger.info("[adjust-section] Sending parent section to Claude:", {
        subsectionIds: Object.keys(subsections),
        subsectionsContentLength: subsectionsList.length,
        feedbackLength: feedbackText.length,
      });

      const prompt = `You are a medical documentation assistant. A doctor has provided feedback on a parent section that contains multiple subsections.

${sourcesSection ? `**ORIGINAL SOURCES** (for reference and verification):\n${sourcesSection}\n` : ""}${noteContext}**Current Subsections:**
${subsectionsList}

**Doctor's Feedback:**
${feedbackText}

**Instructions:**
- Analyze the feedback to identify which subsections it refers to
- Use FLEXIBLE MATCHING to map feedback to subsection labels:
  * Match partial words (any word in feedback appearing in a label, regardless of case)
  * Use your medical knowledge to match medical terms across languages
  * Match medical concepts to their appropriate subsections (e.g., a blood pressure value belongs in a blood pressure subsection)
  * When feedback contains medical measurements or findings, identify the relevant subsection by medical context
- For each matched subsection:
  * If it's empty and feedback implies content should exist, generate appropriate content
  * If it has content and feedback requests changes, update it accordingly
  * Maintain consistent format and style with existing content
${sourcesSection ? "- You may cross-reference the original sources above to verify facts\n- If the feedback conflicts with the sources, trust the doctor's feedback (they know the patient best)" : "- Work with the current subsection contents as your sole reference"}
${noteContext ? "- You may reference the other sections of the note above for medical context (e.g., lab results, findings)" : ""}
- NEVER output meta-commentary, explanations, or apologies — return ONLY the JSON object

Return a JSON object with ONLY the subsections that need updating. Use this format:
{
  "subsection-id-1": "updated content here",
  "subsection-id-2": "updated content here"
}

If no subsections need updating, return an empty object: {}

Return ONLY the JSON object, with no additional commentary or explanation.`;

      const response = await anthropic().messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        temperature: 0.3,
        messages: [{ role: "user", content: prompt }],
      });

      logUsage({
        userId,
        visitId,
        provider: "anthropic",
        model: response.model,
        operation: "adjust_section",
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      });

      const responseText = response.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("");

      logger.info("[adjust-section] Claude response received:", {
        responseLength: responseText.length,
      });

      // Parse JSON response
      let updates: Record<string, string> = {};
      try {
        updates = JSON.parse(responseText.trim());
        logger.info("[adjust-section] Parsed updates:", {
          updateCount: Object.keys(updates).length,
          updateKeys: Object.keys(updates),
        });
      } catch (error) {
        logger.error("[adjust-section] Failed to parse Claude response:", {
          error,
          responseLength: responseText.length,
        });
        throw new Error("Failed to parse subsection updates");
      }

      logger.info(
        `[adjust-section] Parent section ${sectionId} adjusted successfully`,
        {
          sectionId,
          updatedSubsectionCount: Object.keys(updates).length,
          updatedSubsectionIds: Object.keys(updates),
        },
      );

      return NextResponse.json({ updates });
    }

    // Handle single section regeneration
    logger.info(
      `[adjust-section] Adjusting section ${sectionId} for visit ${visitId}`,
      {
        sectionId,
        currentContentLength: currentContent.length,
        feedbackLength: feedbackText.length,
      },
    );

    const prompt = `You are a medical documentation assistant. A doctor has reviewed a section of a medical note and provided feedback to improve it.

${sourcesSection ? `**ORIGINAL SOURCES** (for reference and verification):\n${sourcesSection}\n` : ""}${noteContext}**Current Section Content:**
${currentContent}

**Doctor's Feedback:**
${feedbackText}

**Instructions:**
- Carefully read the doctor's feedback
- Adjust ONLY what the feedback specifically requests
- Keep all other information unchanged unless the feedback explicitly asks for changes
- Maintain the same format and style as the original
${sourcesSection ? "- You may cross-reference the original sources above to verify facts\n- If the feedback conflicts with the sources, trust the doctor's feedback (they know the patient best)" : "- Work with the current section content as your sole reference"}
${noteContext ? "- You may reference the other sections of the note above for medical context (e.g., lab results, findings)" : ""}
- If the feedback asks to remove something, remove it
- If the feedback asks to fix a typo or error, fix it precisely
- If the feedback asks to add information, integrate it naturally into the existing content
- Do not add, remove, or modify anything not mentioned in the feedback
- NEVER output meta-commentary, explanations, or apologies — return ONLY the adjusted medical content

Return ONLY the adjusted section content, with no additional commentary or explanation.`;

    // Call Claude
    const response = await anthropic().messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      temperature: 0.3, // Lower temperature for precision
      messages: [{ role: "user", content: prompt }],
    });

    logUsage({
      userId,
      visitId,
      provider: "anthropic",
      model: response.model,
      operation: "adjust_section",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    const adjustedContent =
      response.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("") || currentContent;

    logger.info(`[adjust-section] Section ${sectionId} adjusted successfully`, {
      sectionId,
      originalLength: currentContent.length,
      adjustedLength: adjustedContent.length,
    });

    return NextResponse.json({
      sectionId,
      content: adjustedContent,
    });
  } catch (error) {
    logger.error("[adjust-section] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
