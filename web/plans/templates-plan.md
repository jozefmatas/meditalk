# Templates as the Core Generation Pipeline (Baby Steps)

## Context

Templates are currently static TypeScript objects with just section IDs and i18n keys. The prompt sent to Anthropic is hardcoded — same for every template. We want each template to own its prompt, style examples, and section structure so we can iterate on generation quality without code changes.

**Approach:** Build fresh on `main`, one step at a time. Each step is independently shippable and doesn't break what works now. Use the `templates` branch as reference/inspiration only.

---

## Step 1: Add `systemPrompt` to Template type + prompt injection

_Smallest change with biggest impact — makes prompts per-template configurable._

**Status:** [x] Done

### 1A. Extend `Template` interface

**File:** `web/src/lib/templates/types.ts`

```typescript
export interface Template {
  id: string;
  nameKey: string;
  descriptionKey: string;
  sections: TemplateSection[];
  systemPrompt?: string; // NEW: custom prompt (undefined = use default)
}
```

### 1B. Extract default prompt as constant + add interpolation

**File:** `web/src/lib/anthropic.ts`

- Extract the current hardcoded prompt body into `DEFAULT_SYSTEM_PROMPT` with placeholders: `{{sections}}`, `{{language}}`
- Modify `buildTemplateSystemPrompt()`: if `template.systemPrompt` exists, interpolate it; otherwise use `DEFAULT_SYSTEM_PROMPT`
- No functional change yet — all static templates have `systemPrompt: undefined`, so they use the default

### 1C. Test it

- Add test: `buildTemplateSystemPrompt()` with custom prompt interpolates `{{sections}}` correctly
- Add test: `buildTemplateSystemPrompt()` without custom prompt matches current behavior
- `npm run build` passes

**Result:** Prompt is now per-template configurable in code. No UI yet, no DB yet.

---

## Step 2: Add `styleExamples` to Template + inject into prompt

_Style examples let us feed reference notes into the prompt._

**Status:** [x] Done

### 2A. Extend `Template` interface

**File:** `web/src/lib/templates/types.ts`

```typescript
export interface Template {
  // ...existing...
  styleExamples?: { name: string; text: string }[];
}
```

### 2B. Append style examples in `buildTemplateSystemPrompt()`

**File:** `web/src/lib/anthropic.ts`

If `template.styleExamples` has entries, append:

```
STYLE REFERENCE (match this writing style, tone, and formatting):
--- Example 1 ---
[text]
```

### 2C. Test it

- Test: style examples appended correctly
- Test: empty array → no style section
- `npm run build` passes

**Result:** Style examples work in the pipeline. Still code-only, no UI.

---

## Step 3: Create `templates` table in Supabase

_Move templates from static code to the database._

**Status:** [x] Done

### 3A. Write migration

**File:** `web/supabase/migrations/006_templates.sql`

```sql
CREATE TABLE templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  specialties text[] NOT NULL DEFAULT '{}',
  sections jsonb NOT NULL DEFAULT '[]',
  system_prompt text,
  style_examples jsonb NOT NULL DEFAULT '[]',
  is_system boolean NOT NULL DEFAULT false,
  visible boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: users see visible system templates + own custom templates
-- Admin (service role) sees all
```

Seed all 4 system templates with their section structures. `system_prompt = NULL` (use default).

### 3B. Add `DbTemplateRow` + `dbRowToTemplate()` converter

**File:** `web/src/lib/templates/types.ts`

Map DB rows to the `Template` interface. System templates use `nameKey`/`descriptionKey` (i18n), custom templates use `name`/`description` directly.

### 3C. Apply migration

```
cd web && npm exec -- supabase db push
```

**Result:** Templates table exists. Nothing reads from it yet.

---

## Step 4: Templates API with static fallback

_Frontend can fetch templates from DB, gracefully falling back to static._

**Status:** [x] Done

### 4A. Create API route

**File:** `web/src/app/api/templates/route.ts`

GET: fetch from Supabase `templates` table. If query fails (table missing, network error), fall back to `STATIC_TEMPLATES` from `src/lib/templates/index.ts`.

### 4B. Update dashboard to use API

**File:** `web/src/app/[locale]/(app)/page.tsx`

Fetch templates from `/api/templates` instead of using `STATIC_TEMPLATES` directly. Keep static fallback in the `catch` block.

### 4C. Update generate route

**File:** `web/src/app/api/generate/route.ts`

Fetch template from DB by ID (with static fallback). The fetched template now includes `systemPrompt` and `styleExamples`, which flow into `buildTemplateSystemPrompt()` automatically.

**Result:** App works identically but templates come from DB. If DB fails, static templates still work.

---

## Step 5: Admin template list page

_See and manage templates from admin._

**Status:** [ ] Not started

### 5A. Add Templates tab to admin dashboard

**File:** `admin/app/page.tsx`

Add "Templates" alongside existing Dashboard/Users/Encounters tabs.

### 5B. Template list with visibility toggle

**File:** `admin/app/templates/page.tsx` (new)

Table: Name, Type (system/custom), Section count, Visible (toggle switch), Edit link.

### 5C. Admin API routes

- `admin/app/api/templates/route.ts` — GET all templates (service role, bypasses RLS)
- `admin/app/api/templates/[id]/route.ts` — PATCH (update visible, name, etc.)

**Result:** Admin can see all templates and toggle visibility.

---

## Step 6: Admin template builder — Section editor

_Build/edit template sections from admin._

**Status:** [ ] Not started

### 6A. Template builder page shell

**File:** `admin/app/templates/[id]/page.tsx` (new)

Tabs or panels layout. Start with metadata (name, description, specialties) and section editor.

### 6B. Section editor component

**File:** `admin/app/templates/_components/section-editor.tsx` (new)

- List of sections with text input for name
- Level indicator: H2 (header) or H3 (subheader) — dropdown or toggle
- Up/Down arrow buttons for reordering
- Add section / Add subsection buttons
- Delete button per section
- Auto-generated slug ID (read-only)

### 6C. Save to DB

PATCH `admin/app/api/templates/[id]/route.ts` — updates `sections` JSONB.

**Result:** Admin can create/edit template section structure.

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

**File:** `web/src/app/api/admin/extract/route.ts` (new)

POST: accepts file upload, extracts text using existing `file-extraction.ts` logic. Protected by `ADMIN_API_SECRET` header.

### 8B. Style examples panel in template builder

Add to the builder:

- Upload button (PDF, images, text files)
- Calls extraction endpoint → gets `{name, text}`
- List of extracted examples with editable textarea
- Add/Remove

### 8C. Save to DB

PATCH updates `style_examples` JSONB column.

**Result:** Admin can upload example notes → extracted text becomes part of the generation prompt.

---

## Key Files Summary

| File                                        | Step  | Change                                                                |
| ------------------------------------------- | ----- | --------------------------------------------------------------------- |
| `web/src/lib/templates/types.ts`            | 1,2,3 | Add `systemPrompt`, `styleExamples`, `DbTemplateRow`                  |
| `web/src/lib/anthropic.ts`                  | 1,2   | `DEFAULT_SYSTEM_PROMPT`, custom prompt interpolation, style injection |
| `web/supabase/migrations/006_templates.sql` | 3     | Full schema with all fields                                           |
| `web/src/app/api/templates/route.ts`        | 4     | GET with DB + static fallback                                         |
| `web/src/app/api/generate/route.ts`         | 4     | Fetch template from DB                                                |
| `web/src/app/[locale]/(app)/page.tsx`       | 4     | Fetch from API                                                        |
| `admin/app/page.tsx`                        | 5     | Add Templates tab                                                     |
| `admin/app/templates/page.tsx`              | 5     | Template list                                                         |
| `admin/app/templates/[id]/page.tsx`         | 6,7,8 | Template builder                                                      |
| `admin/app/api/templates/`                  | 5,6   | CRUD routes                                                           |
| `web/src/app/api/admin/extract/route.ts`    | 8     | File text extraction                                                  |

## Verification per step

Each step: `npm run build` passes, existing tests pass, app works identically to before (until new features are exercised). Write tests for prompt construction (Steps 1-2) and type conversions (Step 3).
