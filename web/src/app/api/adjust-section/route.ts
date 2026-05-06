import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { getTranscript } from "@/lib/encounters/sources";

export const maxDuration = 300;

let _anthropic: Anthropic | null = null;
function anthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ maxRetries: 4 });
  return _anthropic;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      visitId,
      sectionId,
      currentContent,
      feedbackText,
      subsections,
      subsectionLabels,
    } = body;

    // Validate required fields
    // Either currentContent (single section) OR subsections (parent section) must be present
    const isSingleSection = currentContent !== undefined;
    const isParentSection = subsections !== undefined;

    if (
      !visitId ||
      !sectionId ||
      !feedbackText ||
      (!isSingleSection && !isParentSection)
    ) {
      logger.error("[adjust-section] Missing required fields:", {
        visitId: !!visitId,
        sectionId: !!sectionId,
        currentContent: currentContent === undefined ? "undefined" : "present",
        subsections: subsections === undefined ? "undefined" : "present",
        feedbackText: !!feedbackText,
      });
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    // Verify user auth
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch visit with sources
    const { data: visit, error: visitError } = await supabase
      .from("visits")
      .select("id, user_id, metadata")
      .eq("id", visitId)
      .eq("user_id", user.id)
      .single();

    if (visitError || !visit) {
      logger.error("[adjust-section] Visit not found:", {
        visitId,
        userId: user.id,
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

      logger.info("[adjust-section] Subsection labels being sent to Claude:", {
        subsectionLabels,
        subsectionsListPreview: subsectionsList.substring(0, 500),
        feedbackText,
      });

      const prompt = `You are a medical documentation assistant. A doctor has provided feedback on a parent section that contains multiple subsections.

${sourcesSection ? `**ORIGINAL SOURCES** (for reference and verification):\n${sourcesSection}` : ""}**Current Subsections:**
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
- You have access to the original sources to verify facts
- If the feedback conflicts with the sources, trust the doctor's feedback (they know the patient best)

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

      const responseText = response.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("");

      logger.info("[adjust-section] Claude response:", {
        responseLength: responseText.length,
        responsePreview: responseText.substring(0, 500),
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
          responseText,
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

${sourcesSection ? `**ORIGINAL SOURCES** (for reference and verification):\n${sourcesSection}` : ""}**Current Section Content:**
${currentContent}

**Doctor's Feedback:**
${feedbackText}

**Instructions:**
- Carefully read the doctor's feedback
- You have access to the original sources (transcript, notes, files) to verify facts
- Adjust ONLY what the feedback specifically requests
- Keep all other information unchanged unless the feedback explicitly asks for changes
- Maintain the same format and style as the original
- If the feedback asks to remove something, check the sources first - only remove if it's truly incorrect
- If the feedback asks to fix a typo or error, fix it precisely
- If the feedback asks to add information, verify it against the sources and integrate naturally
- Do not add, remove, or modify anything not mentioned in the feedback
- If the feedback conflicts with the sources, trust the doctor's feedback (they know the patient best)

Return ONLY the adjusted section content, with no additional commentary or explanation.`;

    // Call Claude
    const response = await anthropic().messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      temperature: 0.3, // Lower temperature for precision
      messages: [{ role: "user", content: prompt }],
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
