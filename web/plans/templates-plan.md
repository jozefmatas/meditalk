# Templates as the Core Generation Pipeline

## Context

Templates are currently static TypeScript objects with section IDs (English slugs), i18n keys, and a hardcoded prompt. We want each template to own its prompt, style examples, section structure, and per-locale labels — all editable from admin without code deploys.

**Approach:** Build fresh on `main`, one step at a time. Each step is independently shippable.

---

## Architecture Overview

### Data Model (Refined)

```typescript
// web/src/lib/templates/types.ts

export interface TemplateSection {
  id: string;                         // nanoid hash, e.g. "s_a7x9kM3pqR"
  labels: Record<string, string>;     // { sk: "Srdce", en: "Heart", cs: "Srdce" }
  context?: string;                   // AI guidance: "Auscultation findings, murmurs, rhythm"
  subsections?: TemplateSection[];
}

export interface Template {
  id: string;                              // uuid from DB
  name: Record<string, string>;            // { sk: "Základný SOAP", en: "Basic SOAP" }
  description: Record<string, string>;     // { sk: "...", en: "..." }
  sections: TemplateSection[];
  systemPrompt?: string;
  styleExamples?: { name: string; text: string }[];
  specialties?: string[];
  isSystem?: boolean;
  sourceTemplateId?: string;
}
```

**Key design decisions:**
- **Section IDs**: Language-neutral nanoid hashes (`s_` + 10 chars), NOT English slugs
- **Labels**: Per-locale display names stored directly in section JSONB — no i18n file dependency
- **Context**: Per-section AI guidance injected into generation prompt
- **All templates are system templates** (admin-managed). Per-doctor custom templates are future work.

### i18n Transition

Labels move from static JSON files (`messages/sk.json → templates.sections.heart`) to the template's `sections` JSONB in the database. This enables admin editing without code deploys.

**Before:** `tTemplates(\`sections.\${section.labelKey}\`)` → next-intl lookup
**After:** `section.labels[locale] ?? section.labels.sk` → direct object lookup

UI chrome (button labels, page titles) stays in i18n JSON files. Only template/section content moves to DB.

### Translation Flow

Doctor edits section labels in Slovak → on save, system calls Claude Haiku to batch-translate all labels to en/cs → translations stored in `labels` object → doctor can review before final save.

---

## Step 1: Add `systemPrompt` to Template type + prompt injection

_Smallest change with biggest impact — makes prompts per-template configurable._

**Status:** [x] Done (on main)

### 1A–C. Summary

- Extended `Template` interface with `systemPrompt?: string`
- Extracted `DEFAULT_SYSTEM_PROMPT` in `buildTemplateSystemPrompt()`
- Added interpolation for custom prompts
- Tests pass

---

## Step 2: Add `styleExamples` to Template + inject into prompt

**Status:** [x] Done (on main)

### 2A–C. Summary

- Extended `Template` with `styleExamples?: { name: string; text: string }[]`
- Appended style reference to system prompt when present
- Tests pass

---

## Step 3: Refactor types — hash IDs, per-locale labels, context

_Transform the data model before creating the DB table._

**Status:** [ ] Not started

### 3A. Update `TemplateSection` type

**File:** `web/src/lib/templates/types.ts`

- `labelKey: string` → `labels: Record<string, string>` — direct per-locale labels
- Add `context?: string` — AI guidance for section content
- ID format: `s_` prefix + `nanoid(10)` for new sections

### 3B. Update `Template` type

- `nameKey: string` → `name: Record<string, string>`
- `descriptionKey: string` → `description: Record<string, string>`
- Add `specialties?: string[]`, `isSystem?: boolean`, `sourceTemplateId?: string`

### 3C. Add helper functions

**File:** `web/src/lib/templates/index.ts`

```typescript
function generateSectionId(): string          // "s_" + nanoid(10)
function resolveSectionLabel(section, locale)  // labels[locale] ?? labels.sk ?? id
function buildSectionLabelsFromTemplate(template, locale)  // { [id]: label }
function buildSectionContextsFromTemplate(template)        // { [id]: context }
```

Update `FlatSection` type and `flattenTemplateSections()` accordingly.

### 3D. Migrate static templates

- Generate nanoid for every section across all 4 templates
- Populate `labels` from `sk.json`, `en.json`, `cs.json` i18n files
- Convert `nameKey`/`descriptionKey` → `name`/`description` objects
- Update all 4 template files

### 3E. Update consumers

- `buildTemplateSystemPrompt()` — add `sectionContexts` parameter, render context lines
- `generate/route.ts`, `regenerate/route.ts` — use `buildSectionLabelsFromTemplate()` instead of i18n JSON loading
- All UI components — `section.labels[locale]` instead of `tTemplates(...)`
- Remove dead i18n keys (~80 entries under `templates.sections.*`)

### 3F. Tests

- Update existing tests for new section IDs
- Add tests for helpers (resolveSectionLabel, buildSectionLabels, etc.)
- `npm run build` passes

**Result:** Data model is ready for DB storage. Labels come from template objects, not i18n files.

---

## Step 4: Create `templates` table in Supabase + API

_Move templates from static code to the database._

**Status:** [ ] Not started

### 4A. Write migration

**File:** `web/supabase/migrations/006_templates.sql`

```sql
CREATE TABLE templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name jsonb NOT NULL DEFAULT '{}',            -- {"sk":"...","en":"...","cs":"..."}
  description jsonb NOT NULL DEFAULT '{}',
  specialties text[] NOT NULL DEFAULT '{}',
  sections jsonb NOT NULL DEFAULT '[]',        -- TemplateSection[] with labels + context
  system_prompt text,
  style_examples jsonb NOT NULL DEFAULT '[]',
  is_system boolean NOT NULL DEFAULT true,
  visible boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  source_template_id uuid REFERENCES templates(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- No user_id for now (all system-managed from admin)
-- Will add when we support per-doctor custom templates

CREATE INDEX idx_templates_visible ON templates(visible);

ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users see visible templates"
  ON templates FOR SELECT TO authenticated
  USING (visible = true);

CREATE TRIGGER templates_updated_at
  BEFORE UPDATE ON templates
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
```

### 4B. Seed system templates

Insert 4 system templates from updated static files. Sections JSONB includes `labels`, `context`, nanoid IDs.

### 4C. Create API route + fallback

**File:** `web/src/app/api/templates/route.ts`

GET: fetch from Supabase. Fall back to static `TEMPLATES` if DB query fails.

### 4D. Update generate/regenerate routes

Add `resolveTemplate()` — DB fetch with static fallback. Template now carries labels and context natively.

**Result:** App works identically but templates come from DB.

---

## Step 5: Admin template list page

_See and manage templates from admin._

**Status:** [ ] Not started

### 5A. Add Templates nav item to sidebar

**File:** `admin/components/app-sidebar.tsx`

```typescript
{ label: "Templates", href: "/templates", icon: FileStackIcon },
```

### 5B. Template list page

**File:** `admin/app/(admin)/templates/page.tsx`

Table: Name (sk) | Sections count | Visible (toggle) | Edit link

### 5C. Admin API routes

- `admin/app/api/templates/route.ts` — GET all templates (service role, bypasses RLS)
- `admin/app/api/templates/[id]/route.ts` — GET, PATCH, DELETE

**Result:** Admin can see all templates and toggle visibility.

---

## Step 6: Admin template builder — Section editor

_Build/edit template sections from admin._

**Status:** [ ] Not started

### 6A. Template editor page

**File:** `admin/app/(admin)/templates/[id]/page.tsx`

Two panels:

**Metadata panel:**
- Name (text input, Slovak)
- Description (textarea, Slovak)
- Specialties (tags)

**Section editor panel:**
- Tree view of headers (H2) and subheaders (H3)
- Each section row:
  - Drag handle (reorder)
  - Level indicator (H2/H3)
  - Label input (Slovak text)
  - Context textarea (collapsible — "What should go here?")
  - Delete button
- "Add header" / "Add subheader" buttons
- New sections get `nanoid(10)` as ID automatically
- Section IDs shown as read-only badge

### 6B. Translation panel

- "Translate" button → batch-calls Claude Haiku API
- Shows translation preview (en, cs) as editable inputs
- Doctor can review/edit translations before saving

### 6C. Translation API route

**File:** `admin/app/api/templates/translate/route.ts`

POST: accepts section labels in primary locale, returns translations to en/cs via single Haiku call.

### 6D. Duplicate template flow

POST to `admin/app/api/templates/route.ts` with `sourceTemplateId`:
- Deep-clones sections with **new nanoid IDs** for every section
- Sets `source_template_id` for tracking lineage
- Appends " (kópia)" to name

**Result:** Admin can create/edit template sections with context, auto-translate labels, duplicate templates.

---

## Step 7: Admin template builder — Prompt editor

_Edit the system prompt per template from admin._

**Status:** [ ] Not started

### 7A. Prompt editor panel

Add to the template builder page:

- Large textarea showing `systemPrompt`
- Pre-filled with `DEFAULT_SYSTEM_PROMPT` for new templates
- Help text: available variables (`{{sections}}`, `{{language}}`, `{{languageCode}}`)
- "Reset to default" button (clears to null → uses DEFAULT)

### 7B. Save to DB

PATCH updates `system_prompt` column.

**Result:** Admin can customize the Anthropic prompt per template.

---

## Step 8: Admin template builder — Style examples

_Upload reference documents, AI extracts text, injected into prompt._

**Status:** [ ] Not started

### 8A. File extraction endpoint

**File:** `web/src/app/api/admin/extract/route.ts`

POST: accepts file upload, extracts text using existing `file-extraction.ts` logic.

### 8B. Style examples panel

- Upload button (PDF, images, text files)
- Calls extraction endpoint → gets `{name, text}`
- List of extracted examples with editable textarea
- Add/Remove

### 8C. Save to DB

PATCH updates `style_examples` JSONB column.

**Result:** Admin can upload example notes → extracted text becomes part of the generation prompt.

---

## Key Files Summary

| File | Step | Change |
|------|------|--------|
| `web/src/lib/templates/types.ts` | 3 | Hash IDs, `labels`, `context`, updated Template shape |
| `web/src/lib/templates/*.ts` (4 files) | 3 | Migrate to hash IDs + embedded labels |
| `web/src/lib/templates/index.ts` | 3 | Helpers: resolveSectionLabel, generateSectionId, etc. |
| `web/src/lib/anthropic.ts` | 1,2,3 | systemPrompt, styleExamples, context injection |
| `web/src/app/api/generate/route.ts` | 3,4 | Use template labels/context, DB fetch |
| `web/src/app/api/regenerate/route.ts` | 3,4 | Same as generate |
| `web/src/components/encounters/*.tsx` | 3 | section.labels[locale] resolution |
| `web/messages/{sk,en,cs}.json` | 3 | Remove dead templates.sections.* keys |
| `web/supabase/migrations/006_templates.sql` | 4 | DB table + seed |
| `web/src/app/api/templates/route.ts` | 4 | GET with DB + static fallback |
| `admin/components/app-sidebar.tsx` | 5 | Add Templates nav |
| `admin/app/(admin)/templates/page.tsx` | 5 | Template list |
| `admin/app/(admin)/templates/[id]/page.tsx` | 6,7,8 | Template builder (sections, prompt, style) |
| `admin/app/api/templates/*.ts` | 5,6 | CRUD + translate routes |

## Verification per step

Each step: `npm run build` passes, existing tests pass, app works identically to before (until new features are exercised). Write tests for helpers (Step 3), prompt construction (Steps 1-2), and type conversions (Step 4). Verify existing encounters still parse correctly with new section IDs (positional matching).
