export interface TemplateSection {
  id: string;
  labelKey: string;
  labels?: Partial<Record<string, string>>;
  context?: string;
  subsections?: TemplateSection[];
}

export interface StyleExample {
  name: string;
  text: string;
}

export interface Template {
  id: string;
  nameKey: string;
  descriptionKey: string;
  sections: TemplateSection[];
  systemPrompt?: string;
  styleExamples?: StyleExample[];
  /** Direct name for custom (non-system) templates */
  name?: string;
  /** Direct description for custom (non-system) templates */
  description?: string;
  visible?: boolean;
}

// ── Database types ──────────────────────────────────────────────────

interface DbSectionJson {
  id: string;
  labelKey: string;
  labels?: Partial<Record<string, string>>;
  context?: string;
  subsections?: DbSectionJson[];
}

export interface DbTemplateRow {
  id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  specialties: string[];
  sections: DbSectionJson[];
  system_prompt: string | null;
  style_examples: StyleExample[];
  is_system: boolean;
  visible: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * Convert a DB row to the app-level Template interface.
 *
 * System templates use `nameKey`/`descriptionKey` for i18n lookup
 * (the DB `name` field stores the i18n key prefix, e.g. "basic-soap").
 * Custom templates use `name`/`description` directly.
 */
export function dbRowToTemplate(row: DbTemplateRow): Template {
  const sections = (row.sections || []).map(mapSection);

  if (row.is_system) {
    return {
      id: row.name, // Use slug for backward compat (clients reference by slug)
      nameKey: `${row.name}.name`,
      descriptionKey: `${row.name}.description`,
      sections,
      systemPrompt: row.system_prompt ?? undefined,
      styleExamples: row.style_examples?.length
        ? row.style_examples
        : undefined,
      visible: row.visible,
    };
  }

  return {
    id: row.id,
    nameKey: row.name,
    descriptionKey: row.description || "",
    name: row.name,
    description: row.description ?? undefined,
    sections,
    systemPrompt: row.system_prompt ?? undefined,
    styleExamples: row.style_examples?.length ? row.style_examples : undefined,
    visible: row.visible,
  };
}

function mapSection(s: DbSectionJson): TemplateSection {
  return {
    id: s.id,
    labelKey: s.labelKey,
    labels: s.labels,
    context: s.context,
    subsections: s.subsections?.map(mapSection),
  };
}
