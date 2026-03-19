import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const MAX_DIFFS = 20;

/**
 * POST /api/templates/:id/insights/diff
 * Receive a diff between original generated note and current edited note.
 * Appends to edit_diffs (FIFO, capped at MAX_DIFFS).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { userId, supabase } = await requireAuth();
    const { id: templateId } = await context.params;

    const body = await request.json();
    const { visitId, currentHtml, originalHtml } = body;

    if (!currentHtml || !originalHtml) {
      return NextResponse.json(
        { error: "currentHtml and originalHtml are required" },
        { status: 400 },
      );
    }

    // Skip if content is identical (whitespace-normalized)
    const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
    if (normalize(currentHtml) === normalize(originalHtml)) {
      return NextResponse.json({ skipped: true });
    }

    // Build a simple diff summary (section-level changes)
    const diffSummary = buildDiffSummary(originalHtml, currentHtml);

    const newDiff = {
      generated_html: originalHtml.slice(0, 5000),
      final_html: currentHtml.slice(0, 5000),
      diff_summary: diffSummary,
      visit_id: visitId,
      created_at: new Date().toISOString(),
    };

    // Upsert insights row — create if doesn't exist
    const { data: existing } = await supabase
      .from("template_insights")
      .select("id, edit_diffs, usage_count")
      .eq("user_id", userId)
      .eq("template_id", templateId)
      .single();

    if (existing) {
      // Append diff, cap at MAX_DIFFS
      const diffs = [...(existing.edit_diffs as unknown[] || []), newDiff].slice(
        -MAX_DIFFS,
      );

      await supabase
        .from("template_insights")
        .update({
          edit_diffs: diffs,
          usage_count: (existing.usage_count || 0) + 1,
          last_used_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("template_insights").insert({
        user_id: userId,
        template_id: templateId,
        edit_diffs: [newDiff],
        usage_count: 1,
        last_used_at: new Date().toISOString(),
      });
    }

    // Check if we should trigger preference analysis
    // (every 5 accumulated diffs)
    if (existing) {
      const totalDiffs = ((existing.edit_diffs as unknown[]) || []).length + 1;
      if (totalDiffs % 5 === 0) {
        // Fire-and-forget analysis trigger
        fetch(
          new URL(
            `/api/templates/${templateId}/insights/analyze`,
            request.url,
          ).toString(),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          },
        ).catch(() => {
          // Analysis is non-critical
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Diff tracking error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * Build a simple text summary of structural differences between two HTML notes.
 */
function buildDiffSummary(originalHtml: string, currentHtml: string): string {
  const extractSections = (html: string): Map<string, string> => {
    const map = new Map<string, string>();
    const regex = /<h[23][^>]*id="([^"]*)"[^>]*>.*?<\/h[23]>([\s\S]*?)(?=<h[23]|$)/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      map.set(match[1], match[2].replace(/<[^>]+>/g, "").trim());
    }
    return map;
  };

  const original = extractSections(originalHtml);
  const current = extractSections(currentHtml);
  const changes: string[] = [];

  for (const [id, text] of current) {
    const origText = original.get(id);
    if (!origText) {
      changes.push(`Added: ${id}`);
    } else if (origText !== text) {
      const lengthDiff = text.length - origText.length;
      changes.push(
        `Modified: ${id} (${lengthDiff > 0 ? "+" : ""}${lengthDiff} chars)`,
      );
    }
  }

  for (const id of original.keys()) {
    if (!current.has(id)) {
      changes.push(`Removed: ${id}`);
    }
  }

  return changes.length > 0 ? changes.join("; ") : "Minor changes";
}
