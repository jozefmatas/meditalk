import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { anthropic } from "@/lib/anthropic";
import { extractJson } from "@/lib/clinical/json-repair";
import { logUsage } from "@/lib/usage";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

interface AnalyzedSection {
  id: string;
  label: string;
  subsections?: { id: string; label: string }[];
}

/**
 * POST /api/templates/analyze-notes
 * Analyze example medical notes and extract a section/subsection structure.
 * Returns proposed sections for the template editor.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();

    const body = await request.json();
    const { text, analyzeStyle } = body;

    if (!text || typeof text !== "string" || text.trim().length < 20) {
      return NextResponse.json(
        { error: "Please provide a medical note with sufficient content" },
        { status: 400 },
      );
    }

    // Style analysis mode — analyze writing patterns instead of sections
    if (analyzeStyle) {
      const styleResponse = await anthropic().messages.create({
        model: HAIKU_MODEL,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: `Analyze these medical notes and extract the documentation style:
1. Writing tone (formal/informal, abbreviation usage)
2. Common medical abbreviations used
3. Preferred section depth and detail level
4. Language patterns and phrasing preferences
Return a concise style guide the AI can follow when generating similar notes.

Notes:
${text.slice(0, 8000)}`,
          },
        ],
      });

      logUsage({
        userId,
        provider: "anthropic",
        model: HAIKU_MODEL,
        operation: "analyze_style",
        inputTokens: styleResponse.usage.input_tokens,
        outputTokens: styleResponse.usage.output_tokens,
      });

      const styleGuide =
        styleResponse.content[0].type === "text"
          ? styleResponse.content[0].text
          : null;

      return NextResponse.json({ styleGuide });
    }

    // Section extraction mode
    const response = await anthropic().messages.create({
      model: HAIKU_MODEL,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `Analyze this medical note and extract the section structure (headers and subheaders).
Return a JSON array where each element has:
- "id": a snake_case identifier for the section (e.g., "chief_complaint", "physical_exam")
- "label": the section header as it appears in the note (preserve original language)
- "subsections": optional array of sub-sections with the same {id, label} format

Only extract actual structural sections/headers, not individual data points.
Keep the hierarchy flat where possible — only nest when there's a clear header/subheader relationship.

Medical note:
${text.slice(0, 8000)}

Return ONLY the JSON array, no other text.`,
        },
      ],
    });

    logUsage({
      userId,
      provider: "anthropic",
      model: HAIKU_MODEL,
      operation: "analyze_note_sections",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    const responseText =
      response.content[0].type === "text" ? response.content[0].text : "[]";

    let sections: AnalyzedSection[];
    try {
      sections = extractJson<AnalyzedSection[]>(responseText);
      if (!Array.isArray(sections)) {
        sections = [];
      }
    } catch {
      sections = [];
    }

    // Validate and clean the sections
    const cleaned = sections
      .filter((s) => s.id && s.label)
      .map((s) => ({
        id: s.id.replace(/[^a-z0-9_]/g, "_").toLowerCase(),
        label: s.label,
        ...(s.subsections?.length
          ? {
              subsections: s.subsections
                .filter((sub) => sub.id && sub.label)
                .map((sub) => ({
                  id: sub.id.replace(/[^a-z0-9_]/g, "_").toLowerCase(),
                  label: sub.label,
                })),
            }
          : {}),
      }));

    return NextResponse.json({ sections: cleaned });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Analyze notes error:", err);
    return NextResponse.json(
      { error: "Failed to analyze notes" },
      { status: 500 },
    );
  }
}
