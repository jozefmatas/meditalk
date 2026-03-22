import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { supabaseAdmin } from "@/lib/supabase";

function generateTemplateId(): string {
  return `t_${nanoid(10)}`;
}

function generateSectionId(): string {
  return `s_${nanoid(10)}`;
}

interface SectionLike {
  id: string;
  labels: Record<string, string>;
  context?: string;
  subsections?: SectionLike[];
}

function deepCloneSections(sections: SectionLike[]): SectionLike[] {
  return sections.map((s) => ({
    ...s,
    id: generateSectionId(),
    subsections: s.subsections ? deepCloneSections(s.subsections) : undefined,
  }));
}

export async function POST(request: NextRequest) {
  try {
    const { sourceTemplateId } = (await request.json()) as {
      sourceTemplateId: string;
    };

    const sb = supabaseAdmin();

    const { data: original, error: fetchError } = await sb
      .from("templates")
      .select("*")
      .eq("id", sourceTemplateId)
      .single();

    if (fetchError || !original) {
      return NextResponse.json(
        { error: "Source template not found" },
        { status: 404 },
      );
    }

    const newId = generateTemplateId();
    const newName = { ...original.name } as Record<string, string>;
    if (newName.sk) newName.sk += " (kópia)";
    if (newName.en) newName.en += " (copy)";
    if (newName.cs) newName.cs += " (kopie)";

    const newSections = deepCloneSections(original.sections);

    // Get next sort_order
    const { data: maxRow } = await sb
      .from("templates")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .single();
    const nextSort = ((maxRow?.sort_order as number) ?? 0) + 1;

    const { error: insertError } = await sb.from("templates").insert({
      id: newId,
      name: newName,
      description: original.description,
      sections: newSections,
      system_prompt: original.system_prompt,
      style_examples: original.style_examples,
      specialties: original.specialties,
      is_system: true,
      visible: false,
      sort_order: nextSort,
      source_template_id: sourceTemplateId,
    });

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ id: newId });
  } catch (err) {
    console.error("[admin] duplicate error:", err);
    return NextResponse.json({ error: "Duplicate failed" }, { status: 500 });
  }
}
