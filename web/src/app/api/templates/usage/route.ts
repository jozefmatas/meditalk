import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/with-auth";
import { logger } from "@/lib/logger";

/**
 * GET /api/templates/usage
 * Returns { [templateId]: usageCount } for the current user.
 */
export const GET = withAuth(
  async ({ auth }) => {
    const { userId, supabase } = auth;
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
  },
  { logPrefix: "templates-usage-get" },
);

/**
 * POST /api/templates/usage
 * Body: { templateId: string }
 * Upserts usage count (increment by 1).
 */
export const POST = withAuth(
  async ({ request, auth }) => {
    const { userId, supabase } = auth;
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
  },
  { logPrefix: "templates-usage-post" },
);
