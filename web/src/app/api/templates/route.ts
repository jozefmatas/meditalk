import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import type { DbTemplateRow } from "@/lib/templates/types";
import { dbRowToTemplate } from "@/lib/templates/types";

/**
 * GET /api/templates
 * List all templates: system templates + user's custom templates.
 * Optionally joins template_insights for usage counts.
 */
export async function GET() {
  try {
    const { userId, supabase } = await requireAuth();

    // Fetch templates with optional insights join
    const { data: rows, error } = await supabase
      .from("templates")
      .select("*")
      .or(`is_system.eq.true,user_id.eq.${userId}`)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching templates:", error);
      return NextResponse.json(
        { error: "Failed to fetch templates" },
        { status: 500 },
      );
    }

    // Fetch insights for usage counts
    const { data: insights } = await supabase
      .from("template_insights")
      .select("template_id, usage_count, last_used_at")
      .eq("user_id", userId);

    const insightsMap = new Map(
      (insights || []).map((i) => [
        i.template_id,
        { usageCount: i.usage_count, lastUsedAt: i.last_used_at },
      ]),
    );

    const templates = (rows as DbTemplateRow[]).map((row) => {
      const template = dbRowToTemplate(row);
      const insight = insightsMap.get(row.id);
      return {
        ...template,
        usageCount: insight?.usageCount ?? 0,
        lastUsedAt: insight?.lastUsedAt ?? null,
      };
    });

    return NextResponse.json({ templates });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Templates list error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/templates
 * Create a new custom template.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId, supabase } = await requireAuth();

    const body = await request.json();
    const { name, description, specialties, sections, sortOrder } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "Template name is required" },
        { status: 400 },
      );
    }

    if (!sections || !Array.isArray(sections) || sections.length === 0) {
      return NextResponse.json(
        { error: "At least one section is required" },
        { status: 400 },
      );
    }

    const { data: row, error } = await supabase
      .from("templates")
      .insert({
        user_id: userId,
        name,
        description: description || null,
        specialties: specialties || [],
        sections,
        is_system: false,
        sort_order: sortOrder ?? 0,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating template:", error);
      return NextResponse.json(
        { error: "Failed to create template" },
        { status: 500 },
      );
    }

    return NextResponse.json(dbRowToTemplate(row as DbTemplateRow), {
      status: 201,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Template creation error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
