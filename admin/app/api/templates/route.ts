import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { supabaseAdmin } from "@/lib/supabase";

function generateTemplateId(): string {
  return `t_${nanoid(10)}`;
}

export async function POST() {
  try {
    const sb = supabaseAdmin();

    // Get next sort_order
    const { data: maxRow } = await sb
      .from("templates")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .single();
    const nextSort = ((maxRow?.sort_order as number) ?? 0) + 1;

    const newId = generateTemplateId();

    const { error } = await sb.from("templates").insert({
      id: newId,
      name: { sk: "", en: "", cs: "" },
      description: { sk: "", en: "", cs: "" },
      sections: [],
      system_prompt: null,
      style_examples: [],
      specialties: [],
      is_system: true,
      visible: false,
      sort_order: nextSort,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ id: newId });
  } catch (err) {
    console.error("[admin] create template error:", err);
    return NextResponse.json({ error: "Create failed" }, { status: 500 });
  }
}
