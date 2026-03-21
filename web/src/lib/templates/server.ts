import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getTemplateById, getDefaultTemplate, TEMPLATES } from "./index";
import type { Template, TemplateSection } from "./types";

/** Convert a DB row (snake_case) to Template type (camelCase). */
function dbRowToTemplate(row: Record<string, unknown>): Template {
  return {
    id: row.id as string,
    name: row.name as Record<string, string>,
    description: row.description as Record<string, string>,
    sections: row.sections as TemplateSection[],
    systemPrompt: (row.system_prompt as string) ?? undefined,
    styleExamples:
      (row.style_examples as { name: string; text: string }[]) ?? undefined,
    specialties: (row.specialties as string[]) ?? undefined,
    isSystem: row.is_system as boolean,
    sourceTemplateId: (row.source_template_id as string) ?? undefined,
  };
}

/**
 * Resolve a template by ID: fetch from Supabase, fall back to static.
 * Used by generate/regenerate routes (server-side only).
 */
export async function resolveTemplate(id: string): Promise<Template> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("templates")
      .select("*")
      .eq("id", id)
      .single();

    if (data) return dbRowToTemplate(data);
  } catch {
    // DB unavailable — fall through to static
  }
  return getTemplateById(id) ?? getDefaultTemplate();
}

/**
 * Fetch all visible templates: from Supabase, fall back to static TEMPLATES.
 * Used by the templates list page (server-side only).
 */
export async function resolveAllTemplates(): Promise<Template[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("templates")
      .select("*")
      .eq("visible", true)
      .order("sort_order");

    if (data?.length) return data.map(dbRowToTemplate);
  } catch {
    // DB unavailable — fall through to static
  }
  return TEMPLATES;
}
