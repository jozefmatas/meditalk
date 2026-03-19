export interface TemplateSection {
  id: string;
  /** i18n key for system templates — resolved at display time */
  labelKey?: string;
  /** Plain text label for custom templates */
  label?: string;
  subsections?: TemplateSection[];
}

export interface Template {
  id: string;
  /** i18n key for system template name */
  nameKey?: string;
  /** Plain text name (custom templates, or resolved display name) */
  name?: string;
  /** i18n key for system template description */
  descriptionKey?: string;
  /** Plain text description */
  description?: string;
  /** Medical specialties this template is for */
  specialties?: string[];
  sections: TemplateSection[];
  /** Whether this is a system-provided template */
  isSystem?: boolean;
  /** Display order */
  sortOrder?: number;
}

/**
 * Raw template row from the database.
 */
export interface DbTemplateRow {
  id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  specialties: string[];
  sections: DbSectionJson[];
  is_system: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface DbSectionJson {
  id: string;
  labelKey?: string;
  label?: string;
  subsections?: DbSectionJson[];
}

/**
 * Template insights row from the database.
 */
export interface TemplateInsights {
  id: string;
  user_id: string;
  template_id: string;
  example_notes: { text: string; uploaded_at: string }[];
  style_guide: string | null;
  edit_diffs: {
    generated_html: string;
    final_html: string;
    diff_summary: string;
    created_at: string;
  }[];
  preference_summary: string | null;
  usage_count: number;
  last_used_at: string | null;
}

/**
 * Convert a DB template row to the Template interface used by the app.
 * For system templates, nameKey/descriptionKey are stored in the name/description fields.
 */
export function dbRowToTemplate(row: DbTemplateRow): Template {
  return {
    id: row.id,
    // System templates store the i18n key in name/description
    ...(row.is_system
      ? { nameKey: row.name, descriptionKey: row.description ?? undefined }
      : { name: row.name, description: row.description ?? undefined }),
    specialties: row.specialties,
    sections: row.sections.map(dbSectionToTemplateSection),
    isSystem: row.is_system,
    sortOrder: row.sort_order,
  };
}

function dbSectionToTemplateSection(s: DbSectionJson): TemplateSection {
  return {
    id: s.id,
    ...(s.labelKey ? { labelKey: s.labelKey } : {}),
    ...(s.label ? { label: s.label } : {}),
    ...(s.subsections
      ? { subsections: s.subsections.map(dbSectionToTemplateSection) }
      : {}),
  };
}
