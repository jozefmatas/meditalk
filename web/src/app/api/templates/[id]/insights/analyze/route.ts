import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { anthropic } from "@/lib/anthropic";
import { logUsage } from "@/lib/usage";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/templates/:id/insights/analyze
 * Analyze accumulated edit diffs and generate/update the preference summary.
 * Triggered automatically after every 5 diffs.
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const { userId, supabase } = await requireAuth();
    const { id: templateId } = await context.params;

    // Fetch existing insights
    const { data: insights, error } = await supabase
      .from("template_insights")
      .select("id, edit_diffs, preference_summary, style_guide")
      .eq("user_id", userId)
      .eq("template_id", templateId)
      .single();

    if (error || !insights) {
      return NextResponse.json(
        { error: "No insights found for this template" },
        { status: 404 },
      );
    }

    const diffs = (insights.edit_diffs as { diff_summary: string; created_at: string }[]) || [];
    if (diffs.length === 0) {
      return NextResponse.json({ skipped: true, reason: "no diffs" });
    }

    // Build the analysis prompt
    const diffSummaries = diffs
      .map((d) => `[${d.created_at}] ${d.diff_summary}`)
      .join("\n");

    const existingSummary = insights.preference_summary
      ? `\nExisting preference summary (update and refine):\n${insights.preference_summary}`
      : "";

    const response = await anthropic().messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Analyze these before/after diffs of AI-generated medical notes.
Identify quality improvement patterns — how the doctor corrects and refines:
- Which sections they expand, shorten, or restructure
- What information they consistently add or remove
- Formatting and language preferences
- Common corrections to AI output

These patterns will be used to improve future note generation quality.
Return a concise summary of documentation preferences.

Edit history:
${diffSummaries}
${existingSummary}`,
        },
      ],
    });

    logUsage({
      userId,
      provider: "anthropic",
      model: HAIKU_MODEL,
      operation: "analyze_preferences",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    const preferenceSummary =
      response.content[0].type === "text"
        ? response.content[0].text
        : insights.preference_summary;

    // Update the insights row
    await supabase
      .from("template_insights")
      .update({
        preference_summary: preferenceSummary,
        updated_at: new Date().toISOString(),
      })
      .eq("id", insights.id);

    return NextResponse.json({ success: true, preferenceSummary });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Insights analysis error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
