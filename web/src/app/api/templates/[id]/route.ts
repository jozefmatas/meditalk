import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import type { DbTemplateRow } from "@/lib/templates/types";
import { dbRowToTemplate } from "@/lib/templates/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/templates/:id
 * Get a single template by ID.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { userId, supabase } = await requireAuth();
    const { id } = await context.params;

    const { data: row, error } = await supabase
      .from("templates")
      .select("*")
      .eq("id", id)
      .or(`is_system.eq.true,user_id.eq.${userId}`)
      .single();

    if (error || !row) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(dbRowToTemplate(row as DbTemplateRow));
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Template fetch error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/templates/:id
 * Update a custom template. System templates cannot be edited directly.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { userId, supabase } = await requireAuth();
    const { id } = await context.params;

    // Verify ownership — only custom templates can be edited
    const { data: existing, error: fetchError } = await supabase
      .from("templates")
      .select("id, user_id, is_system")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 },
      );
    }

    if (existing.is_system) {
      return NextResponse.json(
        { error: "System templates cannot be edited" },
        { status: 403 },
      );
    }

    if (existing.user_id !== userId) {
      return NextResponse.json(
        { error: "Not authorized to edit this template" },
        { status: 403 },
      );
    }

    const body = await request.json();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.specialties !== undefined) updates.specialties = body.specialties;
    if (body.sections !== undefined) updates.sections = body.sections;
    if (body.sortOrder !== undefined) updates.sort_order = body.sortOrder;

    const { data: row, error } = await supabase
      .from("templates")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Error updating template:", error);
      return NextResponse.json(
        { error: "Failed to update template" },
        { status: 500 },
      );
    }

    return NextResponse.json(dbRowToTemplate(row as DbTemplateRow));
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Template update error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/templates/:id
 * Delete a custom template. System templates cannot be deleted.
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { userId, supabase } = await requireAuth();
    const { id } = await context.params;

    // Verify ownership
    const { data: existing, error: fetchError } = await supabase
      .from("templates")
      .select("id, user_id, is_system")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 },
      );
    }

    if (existing.is_system) {
      return NextResponse.json(
        { error: "System templates cannot be deleted" },
        { status: 403 },
      );
    }

    if (existing.user_id !== userId) {
      return NextResponse.json(
        { error: "Not authorized to delete this template" },
        { status: 403 },
      );
    }

    const { error } = await supabase.from("templates").delete().eq("id", id);

    if (error) {
      console.error("Error deleting template:", error);
      return NextResponse.json(
        { error: "Failed to delete template" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Template deletion error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
