import "server-only";

import { createClient } from "@/lib/supabase/server";
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
 * Resolve a template by ID from the database.
 * Used by generate/regenerate routes and /api/templates/[id] (server-side only).
 */
export async function resolveTemplate(id: string): Promise<Template> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    throw new Error(`Template not found: ${id}`);
  }
  return dbRowToTemplate(data);
}

/**
 * Fetch all visible templates from the database.
 * Used by /api/templates route (server-side only).
 */
export async function resolveAllTemplates(): Promise<Template[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .select("*")
    .eq("visible", true)
    .order("sort_order");

  if (error || !data?.length) {
    throw new Error("No templates found in database");
  }
  return data.map(dbRowToTemplate);
}
