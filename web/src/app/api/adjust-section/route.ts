import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude } from "@/lib/anthropic";
import { logger } from "@/lib/logger";
import { getTranscript } from "@/lib/encounters/sources";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { visitId, sectionId, currentContent, feedbackText } = body;

    // Validate required fields
    if (!visitId || !sectionId || !currentContent || !feedbackText) {
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
      .from("encounters")
      .select(
        "id, user_id, doctor_notes, uploaded_files_context, metadata, recordings(transcript)",
      )
      .eq("id", visitId)
      .eq("user_id", user.id)
      .single();

    if (visitError || !visit) {
      return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    }

    logger.info(
      `[adjust-section] Adjusting section ${sectionId} for visit ${visitId}`,
    );

    // Gather sources for context
    const transcript = getTranscript(visit);
    const doctorNotes = visit.doctor_notes || "";
    const uploadedContext = visit.uploaded_files_context || "";

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

    // Build adjustment prompt
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
    const response = await callClaude({
      messages: [{ role: "user", content: prompt }],
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      temperature: 0.3, // Lower temperature for precision
    });

    const adjustedContent = response.content[0]?.text || currentContent;

    logger.info(`[adjust-section] Section ${sectionId} adjusted successfully`);

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
