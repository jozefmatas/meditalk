import { describe, it, expect, vi, beforeEach } from "vitest";
import { dbRowToTemplate, type DbTemplateRow } from "./types";
import {
  fetchTemplateById,
  fetchDefaultTemplate,
  fetchTemplatesFromDb,
} from "./db";
import { TEMPLATES, getDefaultTemplate } from "./index";

// ── dbRowToTemplate ─────────────────────────────────────────────────

describe("dbRowToTemplate", () => {
  const systemRow: DbTemplateRow = {
    id: "00000000-0000-0000-0000-000000000001",
    user_id: null,
    name: "basic-soap",
    description: "basic-soap",
    specialties: ["general_practice"],
    sections: [
      { id: "subjective", labelKey: "subjective" },
      { id: "objective", labelKey: "objective" },
    ],
    system_prompt: null,
    style_examples: [],
    is_system: true,
    visible: true,
    sort_order: 1,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  };

  const customRow: DbTemplateRow = {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    user_id: "user-123",
    name: "My Custom Template",
    description: "A custom one",
    specialties: [],
    sections: [{ id: "notes", labelKey: "notes" }],
    system_prompt: "Custom prompt: {{sections}}",
    style_examples: [{ name: "ex1", text: "Example note text" }],
    is_system: false,
    visible: true,
    sort_order: 0,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  };

  it("converts system row using name as id (slug)", () => {
    const t = dbRowToTemplate(systemRow);
    expect(t.id).toBe("basic-soap"); // slug, not UUID
    expect(t.nameKey).toBe("basic-soap.name");
    expect(t.descriptionKey).toBe("basic-soap.description");
  });

  it("converts system row sections", () => {
    const t = dbRowToTemplate(systemRow);
    expect(t.sections).toHaveLength(2);
    expect(t.sections[0].id).toBe("subjective");
  });

  it("system row with null systemPrompt → undefined", () => {
    const t = dbRowToTemplate(systemRow);
    expect(t.systemPrompt).toBeUndefined();
  });

  it("system row with empty styleExamples → undefined", () => {
    const t = dbRowToTemplate(systemRow);
    expect(t.styleExamples).toBeUndefined();
  });

  it("converts custom row using UUID as id", () => {
    const t = dbRowToTemplate(customRow);
    expect(t.id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(t.name).toBe("My Custom Template");
    expect(t.description).toBe("A custom one");
  });

  it("custom row preserves systemPrompt and styleExamples", () => {
    const t = dbRowToTemplate(customRow);
    expect(t.systemPrompt).toBe("Custom prompt: {{sections}}");
    expect(t.styleExamples).toEqual([{ name: "ex1", text: "Example note text" }]);
  });

  it("handles nested subsections", () => {
    const row: DbTemplateRow = {
      ...systemRow,
      sections: [
        {
          id: "exam",
          labelKey: "exam",
          subsections: [
            { id: "heart", labelKey: "heart" },
            { id: "lungs", labelKey: "lungs" },
          ],
        },
      ],
    };
    const t = dbRowToTemplate(row);
    expect(t.sections[0].subsections).toHaveLength(2);
    expect(t.sections[0].subsections![1].id).toBe("lungs");
  });
});

// ── DB fetch helpers ────────────────────────────────────────────────

function mockSupabase(data: DbTemplateRow[] | null, error: unknown = null) {
  return {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => ({
            single: () => Promise.resolve({ data: data?.[0] ?? null, error }),
          }),
        }),
        eq: (_col: string, _val: string) => ({
          single: () =>
            Promise.resolve({ data: data?.[0] ?? null, error }),
        }),
      }),
    }),
  } as never;
}

const sampleSystemRow: DbTemplateRow = {
  id: "00000000-0000-0000-0000-000000000002",
  user_id: null,
  name: "basic-soap",
  description: "basic-soap",
  specialties: ["general_practice"],
  sections: [
    { id: "subjective", labelKey: "subjective" },
    { id: "objective", labelKey: "objective" },
    { id: "assessment", labelKey: "assessment" },
    { id: "plan", labelKey: "plan" },
  ],
  system_prompt: "Custom SOAP prompt: {{sections}}",
  style_examples: [],
  is_system: true,
  visible: true,
  sort_order: 1,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

describe("fetchTemplateById", () => {
  it("returns DB template when found (slug lookup)", async () => {
    const supabase = mockSupabase([sampleSystemRow]);
    const t = await fetchTemplateById(supabase, "basic-soap");
    expect(t).toBeDefined();
    expect(t!.id).toBe("basic-soap");
    expect(t!.systemPrompt).toBe("Custom SOAP prompt: {{sections}}");
  });

  it("returns DB template when found (UUID lookup)", async () => {
    const supabase = mockSupabase([sampleSystemRow]);
    const t = await fetchTemplateById(
      supabase,
      "00000000-0000-0000-0000-000000000002",
    );
    expect(t).toBeDefined();
    expect(t!.id).toBe("basic-soap");
  });

  it("falls back to static on DB error", async () => {
    const supabase = mockSupabase(null, { message: "DB error" });
    const t = await fetchTemplateById(supabase, "basic-soap");
    // Should fall back to static
    const staticT = TEMPLATES.find((st) => st.id === "basic-soap");
    expect(t).toEqual(staticT);
  });

  it("falls back to static when not found", async () => {
    const supabase = mockSupabase(null);
    const t = await fetchTemplateById(supabase, "basic-soap");
    const staticT = TEMPLATES.find((st) => st.id === "basic-soap");
    expect(t).toEqual(staticT);
  });

  it("returns undefined for unknown template on DB miss", async () => {
    const supabase = mockSupabase(null);
    const t = await fetchTemplateById(supabase, "nonexistent");
    expect(t).toBeUndefined();
  });
});

describe("fetchDefaultTemplate", () => {
  it("returns DB default template", async () => {
    const row: DbTemplateRow = {
      ...sampleSystemRow,
      name: "comprehensive-medical-exam",
      sort_order: 0,
    };
    const supabase = mockSupabase([row]);
    const t = await fetchDefaultTemplate(supabase);
    expect(t.id).toBe("comprehensive-medical-exam");
  });

  it("falls back to static default on error", async () => {
    const supabase = mockSupabase(null, { message: "fail" });
    const t = await fetchDefaultTemplate(supabase);
    expect(t.id).toBe(getDefaultTemplate().id);
  });
});

describe("fetchTemplatesFromDb", () => {
  it("falls back to static TEMPLATES on error", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          order: () =>
            Promise.resolve({ data: null, error: { message: "fail" } }),
        }),
      }),
    } as never;

    const templates = await fetchTemplatesFromDb(supabase);
    expect(templates).toEqual(TEMPLATES);
  });

  it("falls back to static TEMPLATES on empty result", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    } as never;

    const templates = await fetchTemplatesFromDb(supabase);
    expect(templates).toEqual(TEMPLATES);
  });

  it("converts DB rows to templates", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          order: () =>
            Promise.resolve({ data: [sampleSystemRow], error: null }),
        }),
      }),
    } as never;

    const templates = await fetchTemplatesFromDb(supabase);
    expect(templates).toHaveLength(1);
    expect(templates[0].id).toBe("basic-soap");
    expect(templates[0].systemPrompt).toBe("Custom SOAP prompt: {{sections}}");
  });
});
