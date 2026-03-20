import type { SupabaseClient } from "@supabase/supabase-js";
import { dbRowToTemplate, type DbTemplateRow } from "./types";
import type { Template } from "./types";
import {
  getTemplateById as getStaticTemplateById,
  getDefaultTemplate,
  TEMPLATES,
} from "./index";

/**
 * Fetch all visible templates from Supabase.
 * Falls back to static TEMPLATES on any error.
 */
export async function fetchTemplatesFromDb(
  supabase: SupabaseClient,
): Promise<Template[]> {
  try {
    const { data, error } = await supabase
      .from("templates")
      .select("*")
      .order("sort_order", { ascending: true });

    if (error || !data || data.length === 0) {
      return TEMPLATES;
    }

    return (data as DbTemplateRow[]).map(dbRowToTemplate);
  } catch {
    return TEMPLATES;
  }
}

/**
 * Fetch a single template by ID (slug or UUID) from Supabase.
 * System templates are looked up by `name` (slug), custom by `id` (UUID).
 * Falls back to static lookup on any error.
 */
export async function fetchTemplateById(
  supabase: SupabaseClient,
  templateId: string,
): Promise<Template | undefined> {
  try {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        templateId,
      );

    const { data, error } = await supabase
      .from("templates")
      .select("*")
      .eq(isUuid ? "id" : "name", templateId)
      .single();

    if (error || !data) {
      return getStaticTemplateById(templateId);
    }

    return dbRowToTemplate(data as DbTemplateRow);
  } catch {
    return getStaticTemplateById(templateId);
  }
}

/**
 * Fetch the default template from DB (sort_order 0, system template).
 * Falls back to static default.
 */
export async function fetchDefaultTemplate(
  supabase: SupabaseClient,
): Promise<Template> {
  try {
    const { data, error } = await supabase
      .from("templates")
      .select("*")
      .eq("is_system", true)
      .order("sort_order", { ascending: true })
      .limit(1)
      .single();

    if (error || !data) {
      return getDefaultTemplate();
    }

    return dbRowToTemplate(data as DbTemplateRow);
  } catch {
    return getDefaultTemplate();
  }
}
