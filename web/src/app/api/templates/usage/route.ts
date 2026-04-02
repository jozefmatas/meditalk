import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { logger } from "@/lib/logger";

/**
 * GET /api/templates/usage
 * Returns { [templateId]: usageCount } for the current user.
 */
export async function GET() {
  try {
    const { userId, supabase } = await requireAuth();

    const { data, error } = await supabase
      .from("template_usage")
      .select("template_id, usage_count")
      .eq("user_id", userId);

    if (error) {
      logger.error("Failed to fetch template usage:", error);
      return NextResponse.json(
        { error: "Failed to fetch usage" },
        { status: 500 },
      );
    }

    const usage: Record<string, number> = {};
    for (const row of data) {
      usage[row.template_id] = row.usage_count;
    }

    return NextResponse.json(usage);
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/templates/usage
 * Body: { templateId: string }
 * Upserts usage count (increment by 1).
 */
export async function POST(request: NextRequest) {
  try {
    const { userId, supabase } = await requireAuth();
    const { templateId } = await request.json();

    if (!templateId || typeof templateId !== "string") {
      return NextResponse.json(
        { error: "templateId is required" },
        { status: 400 },
      );
    }

    const { error } = await supabase.rpc("increment_template_usage", {
      p_user_id: userId,
      p_template_id: templateId,
    });

    if (error) {
      logger.error("Failed to track template usage:", error);
      return NextResponse.json(
        { error: "Failed to track usage" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
