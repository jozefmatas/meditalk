import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/** Guardrails for admin-submitted style_examples (the reference-note corpus). */
const MAX_EXAMPLE_TEXT_CHARS = 20_000;
const MAX_EXAMPLES_PER_TEMPLATE = 50;

function validateStyleExamples(value: unknown): string | null {
  if (value === null || value === undefined) return null; // nothing to check
  if (!Array.isArray(value)) return "style_examples must be an array";
  if (value.length > MAX_EXAMPLES_PER_TEMPLATE) {
    return `style_examples capped at ${MAX_EXAMPLES_PER_TEMPLATE} entries`;
  }
  for (const [i, entry] of value.entries()) {
    if (!entry || typeof entry !== "object") {
      return `style_examples[${i}]: not an object`;
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.name !== "string" || e.name.trim().length === 0) {
      return `style_examples[${i}].name: required non-empty string`;
    }
    if (typeof e.text !== "string") {
      return `style_examples[${i}].text: required string`;
    }
    if (e.text.length > MAX_EXAMPLE_TEXT_CHARS) {
      return `style_examples[${i}].text: exceeds ${MAX_EXAMPLE_TEXT_CHARS} chars`;
    }
  }
  return null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();

  if ("style_examples" in body) {
    const err = validateStyleExamples(body.style_examples);
    if (err) {
      return NextResponse.json({ error: err }, { status: 400 });
    }
  }

  const sb = supabaseAdmin();
  const { error } = await sb.from("templates").update(body).eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const sb = supabaseAdmin();
  const { error } = await sb.from("templates").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
