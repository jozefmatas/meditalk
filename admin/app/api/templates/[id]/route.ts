import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/templates/:id
 *
 * Fetch a single template by UUID.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("templates")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error("Failed to fetch template:", error);
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  return NextResponse.json(data);
}

/**
 * PATCH /api/templates/:id
 *
 * Update template fields (visible, name, description, sort_order, etc.).
 * Uses service role — bypasses RLS.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();

  // Only allow specific fields to be updated
  const allowedFields = [
    "name",
    "description",
    "visible",
    "sort_order",
    "sections",
    "system_prompt",
    "style_examples",
    "specialties",
  ];

  const updates: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in body) {
      updates[key] = body[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 },
    );
  }

  updates.updated_at = new Date().toISOString();

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("templates")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Failed to update template:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
