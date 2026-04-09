# MediTalk

AI-powered medical documentation platform. Records consultations, transcribes audio, extracts text from uploaded files (PDFs, images, audio), and generates structured medical notes using Claude.

## Tech Stack

| Layer           | Technology                                                     |
| --------------- | -------------------------------------------------------------- |
| Framework       | Next.js 16 (App Router)                                        |
| Language        | TypeScript 5                                                   |
| UI              | React 19, Tailwind CSS v4 (PostCSS), shadcn (radix-nova style) |
| Icons           | `@hugeicons/react` + `@hugeicons/core-free-icons`              |
| Editor          | TipTap 3 (StarterKit, Placeholder, Slash Commands)             |
| AI Generation   | Anthropic Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`)     |
| Transcription   | OpenAI Whisper (`whisper-1`)                                   |
| Embeddings      | OpenAI `text-embedding-ada-002` (1536 dimensions)              |
| PDF Parsing     | `pdf-parse` v2                                                 |
| Database        | Supabase (PostgreSQL + pgvector + Storage)                     |
| Auth            | Supabase Magic Link                                            |
| i18n            | `next-intl` — Slovak (default), Czech, English                 |
| Animations      | Motion (Framer Motion)                                         |
| Variants        | `class-variance-authority` (CVA)                               |
| Package manager | npm                                                            |

## Project Structure

```
meditalk/
├── .storybook/                  # Storybook 10 config
├── messages/                    # i18n translations (sk.json, cs.json, en.json)
├── public/                      # Static assets
├── supabase/migrations/         # SQL migrations (001–004)
├── src/
│   ├── app/
│   │   ├── [locale]/            # Localized pages
│   │   │   ├── encounters/[visitId]/  # Main encounter page
│   │   │   ├── login/           # Auth page
│   │   │   ├── settings/        # User settings
│   │   │   ├── templates/       # Template browser
│   │   │   ├── page.tsx         # Dashboard
│   │   │   └── layout.tsx       # Root layout (font, providers)
│   │   ├── api/                 # API routes
│   │   │   ├── encounters/      # CRUD + file management
│   │   │   ├── generate/        # AI note generation
│   │   │   ├── process-audio/   # Audio transcription pipeline
│   │   │   └── search/          # Semantic search
│   │   ├── auth/callback/       # Supabase auth callback
│   │   └── globals.css          # Tailwind v4 theme (@theme inline, OKLch)
│   ├── components/
│   │   ├── editor/              # TipTap editor + slash commands
│   │   ├── encounters/          # Encounter-specific (recording, files, template sidebar)
│   │   ├── generated/ui/       # Raw shadcn components — NEVER edit directly
│   │   ├── nav/                 # AppShell, sidebar, header
│   │   ├── shared/              # Wrapper components (import from here)
│   │   └── templates/           # Template display components
│   ├── hooks/                   # Custom React hooks
│   ├── i18n/                    # next-intl config (routing, request)
│   ├── lib/
│   │   ├── supabase/            # Client, server, auth helpers
│   │   ├── templates/           # Template definitions + HTML builder
│   │   ├── anthropic.ts         # Claude generation (SOAP, template-based)
│   │   ├── openai.ts            # Whisper transcription + embeddings
│   │   ├── chunking.ts          # Text chunking with overlap
│   │   ├── file-extraction.ts   # PDF/image/audio text extraction
│   │   ├── types.ts             # TypeScript types
│   │   └── utils.ts             # cn() utility
│   └── test/                    # Test setup
├── components.json              # shadcn config → ui: @/components/generated/ui
├── vitest.config.ts             # Vitest config (unit + storybook projects)
├── next.config.ts               # Next.js config with next-intl plugin
└── package.json
```

## Environment Setup

### Required Environment Variables

Create `.env.local`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# OpenAI (Whisper transcription + embeddings)
OPENAI_API_KEY=sk-...

# Anthropic (Claude generation)
ANTHROPIC_API_KEY=sk-ant-...
```

### Scripts

| Script                     | Command                            | Description                      |
| -------------------------- | ---------------------------------- | -------------------------------- |
| `npm run dev`              | `next dev -p 8111`                 | Dev server on port 8111          |
| `npm run build`            | `next build`                       | Production build                 |
| `npm test`                 | `vitest`                           | Run all tests (unit + storybook) |
| `npm run test:unit`        | `vitest --project unit`            | Run unit tests only              |
| `npm run storybook`        | `storybook dev -p 8001`            | Storybook on port 8001           |
| `npm run db:push`          | `supabase db push`                 | Push migrations to remote        |
| `npm run db:reset`         | `supabase db reset --linked --yes` | Reset remote DB                  |
| `npm run db:types`         | `supabase gen types ...`           | Generate TS types from DB        |
| `npm run db:migration:new` | `supabase migration new`           | Create new migration             |
| `npm run db:status`        | `supabase migration list --linked` | Check migration status           |

### Running Locally

```bash
npm install
# Set up .env.local with required variables
npm run db:push        # Apply migrations to Supabase
npm run dev            # http://localhost:8111
```

## Database Schema

### Migrations

Applied in order:

1. **001_initial_schema.sql** — pgvector extension, `transcripts` table, `transcript_chunks` table with vector index, `match_chunks()` RPC function, RLS policies
2. **002_visits_schema.sql** — Rename `transcripts` → `visits`, add visit columns (visit_date, patient_name, patient_id, visit_type, status, soap_note, patient_letter, metadata), rename `transcript_id` → `visit_id`, add indexes, update RLS and `match_chunks()`
3. **003_encounter_statuses.sql** — Migrate status values (completed → closed)
4. **004_encounter_files_bucket.sql** — Create `encounter-files` storage bucket with RLS policies

### Tables

#### `visits` (originally `transcripts`)

| Column           | Type        | Default             | Description                                                                               |
| ---------------- | ----------- | ------------------- | ----------------------------------------------------------------------------------------- |
| `id`             | uuid        | `gen_random_uuid()` | Primary key                                                                               |
| `user_id`        | uuid        | —                   | FK to `auth.users`, cascade delete                                                        |
| `title`          | text        | null                | Encounter title                                                                           |
| `audio_path`     | text        | null                | Path in `encounter-files` bucket                                                          |
| `raw_text`       | text        | null                | Full transcribed text                                                                     |
| `language`       | text        | `'en'`              | `'en'` / `'sk'` / `'cs'`                                                                  |
| `visit_date`     | timestamptz | `now()`             | Date of visit                                                                             |
| `patient_name`   | text        | null                | Patient name                                                                              |
| `patient_id`     | text        | null                | Patient identifier                                                                        |
| `visit_type`     | text        | `'consultation'`    | consultation, follow_up, preventive, acute, specialist_referral, telemedicine, home_visit |
| `status`         | text        | `'draft'`           | started, recording, processing, to_review, completed, archived                            |
| `soap_note`      | text        | null                | Generated medical note (HTML)                                                             |
| `patient_letter` | text        | null                | Patient-friendly letter                                                                   |
| `metadata`       | jsonb       | `'{}'`              | Flexible metadata (files[], doctor_notes, template_id)                                    |
| `created_at`     | timestamptz | `now()`             | Creation timestamp                                                                        |

**Indexes:**

- `idx_visits_user_date` — (user_id, visit_date DESC)
- `idx_visits_status` — (user_id, status)
- `idx_visits_patient` — (user_id, patient_name)

#### `transcript_chunks`

| Column        | Type         | Description                    |
| ------------- | ------------ | ------------------------------ |
| `id`          | uuid         | Primary key                    |
| `visit_id`    | uuid         | FK to `visits`, cascade delete |
| `chunk_index` | int          | Position in sequence           |
| `content`     | text         | Chunk text                     |
| `embedding`   | vector(1536) | OpenAI embedding               |
| `created_at`  | timestamptz  | Creation timestamp             |

**Index:** IVFFlat on `embedding` for cosine similarity (100 lists)

### Storage

Single bucket: **`encounter-files`** (private)

- Stores: audio recordings, uploaded PDFs, images, audio files
- Path pattern: `{userId}/{encounterId}/{fileId}-{filename}` (uploaded files) or `{userId}/{fileId}-{filename}` (recordings)
- RLS: Users can only access files in their own folder (`storage.foldername(name)[1] = auth.uid()`)

### RPC Functions

#### `match_chunks(query_embedding, match_count, p_visit_id)`

Semantic search using cosine similarity. Returns chunks ordered by relevance.

- `query_embedding` — vector(1536), the query to match against
- `match_count` — int, default 10, number of results
- `p_visit_id` — uuid, optional, filter to specific visit
- Returns: `id`, `visit_id`, `chunk_index`, `content`, `similarity`
- Security: `SECURITY DEFINER`, enforces `auth.uid()` ownership

## API Routes

### `POST /api/process-audio`

Transcribe audio, chunk text, generate embeddings, store everything.

**Request:** `multipart/form-data`

| Field      | Type   | Required | Description                          |
| ---------- | ------ | -------- | ------------------------------------ |
| `file`     | File   | Yes      | Audio file (any `audio/*`, max 50MB) |
| `title`    | string | No       | Encounter title                      |
| `language` | string | Yes      | `en` / `sk` / `cs`                   |
| `visitId`  | string | No       | Attach to existing visit             |

**Response:** `ProcessAudioResponse`

```json
{
  "visitId": "uuid",
  "audioPath": "userId/fileId-filename",
  "chunkCount": 12,
  "transcriptText": "full transcribed text..."
}
```

**Pipeline:**

1. Validate file type and size
2. Upload to `encounter-files` bucket
3. Transcribe via Whisper
4. Create or update visit in DB
5. Chunk text (1000 chars, 200 overlap, sentence boundaries)
6. Batch-embed all chunks
7. Store chunks with embeddings

### `POST /api/generate`

Generate a medical note from transcript chunks + doctor notes + uploaded files.

**Request:** JSON

```json
{
  "visitId": "uuid",
  "templateId": "comprehensive-medical-exam",
  "doctorNotes": "optional additional notes"
}
```

**Response:** `GenerateResponse`

```json
{
  "generatedNote": "<h2>...</h2><p>...</p>",
  "letter": "Patient-friendly summary...",
  "suggestedTitle": "Kontrola krvneho tlaku",
  "usedChunks": ["chunk-id-1", "chunk-id-2"],
  "templateId": "comprehensive-medical-exam"
}
```

**Pipeline:**

1. Fetch visit (language, metadata)
2. Collect extracted text from uploaded files (`metadata.files[].extracted_text`)
3. Load template + section labels from locale messages
4. Embed a clinical retrieval query per language
5. `match_chunks()` RPC — retrieve top 16 relevant chunks
6. Call Claude Sonnet 4.5 with: chunks + file texts + doctor notes
7. Parse JSON response, build HTML from template sections
8. Save `soap_note` and `patient_letter` to visit
9. Return generated content

### `GET /api/encounters`

List encounters with pagination, filtering, sorting.

**Query params:**

| Param       | Default      | Description                                  |
| ----------- | ------------ | -------------------------------------------- |
| `page`      | 1            | Page number                                  |
| `limit`     | 10 (max 50)  | Items per page                               |
| `status`    | —            | Filter by status                             |
| `search`    | —            | Search title + patient name (ilike)          |
| `sortBy`    | `visit_date` | `visit_date` / `created_at` / `patient_name` |
| `sortOrder` | `desc`       | `asc` / `desc`                               |

**Response:** `EncounterListResponse`

### `POST /api/encounters`

Create a new encounter.

**Request:** `CreateEncounterRequest` (all fields optional)

### `GET /api/encounters/[encounterId]`

Fetch single encounter with chunk count.

### `PATCH /api/encounters/[encounterId]`

Update encounter fields.

**Request:** `UpdateEncounterRequest`

### `DELETE /api/encounters/[encounterId]`

Soft delete (archive). Pass `?hard=true` for permanent deletion.

### `GET /api/encounters/[encounterId]/files`

List files stored in `visit.metadata.files[]`.

### `POST /api/encounters/[encounterId]/files`

Upload file(s), extract text, store in Supabase Storage.

**Request:** `multipart/form-data` — field `files` (multiple)

**Pipeline per file:**

1. Upload to `encounter-files` bucket at `{userId}/{encounterId}/{fileId}-{filename}`
2. Extract text via `extractTextFromFile()` (see File Extraction Pipeline)
3. Store file metadata in `visit.metadata.files[]` including `extracted_text`

### `DELETE /api/encounters/[encounterId]/files?fileId=...`

Remove file from storage and metadata.

### `POST /api/search`

Semantic search within a visit's transcript chunks.

**Request:**

```json
{
  "visitId": "uuid",
  "query": "blood pressure medication",
  "k": 10
}
```

## Core Libraries

### `src/lib/anthropic.ts`

Claude AI integration. Model: `claude-sonnet-4-5-20250929`.

- `generateSOAPAndLetter(chunks, language)` — Legacy SOAP generation (returns `{soap, letter}`)
- `generateFromTemplate(chunks, template, language, sectionLabels, doctorNotes?, fileTexts?)` — Template-based generation. Builds structured user message from transcript chunks + uploaded file contents + doctor notes. Returns `{generatedNote, letter, suggestedTitle}`
- System prompts enforce: grounding (no hallucination), output language, missing info handling, JSON format

### `src/lib/openai.ts`

OpenAI integration.

- `transcribeAudio(file, filename)` — Whisper transcription (`whisper-1`)
- `embedText(text)` — Single text embedding (1536 dimensions, `text-embedding-ada-002`)
- `embedTexts(texts[])` — Batch embedding

### `src/lib/chunking.ts`

- `chunkText(text, chunkSize=1000, overlap=200)` — Splits on sentence boundaries (`.` `!` `?`) with character overlap. Falls back to word splitting for long sentences.

### `src/lib/file-extraction.ts`

Unified file text extraction.

- `extractTextFromFile(buffer, filename, mimeType, language)` → `string | null`
- **PDF**: `pdf-parse` for text-based PDFs; falls back to Claude document API (`type: 'document'`) for scanned PDFs (< 50 chars extracted)
- **Image** (PNG/JPEG/GIF/WebP): Claude Vision API (`type: 'image'`, base64)
- **Audio**: Reuses `transcribeAudio()` from openai.ts

### `src/lib/supabase/`

- `client.ts` — Browser client (`createBrowserClient`)
- `server.ts` — Server client with cookie handling
- `auth.ts` — `requireAuth()` — validates auth in API routes, returns `{userId, supabase}`, throws 401 Response if unauthenticated

### `src/lib/templates/`

- `types.ts` — `Template`, `TemplateSection` interfaces
- `index.ts` — Template registry, `getTemplateById()`, `getDefaultTemplate()`, `flattenTemplateSections()`
- `html.ts` — `buildTemplateHtml()`, `flattenSectionIds()`
- `comprehensive-medical-exam.ts` — ~50 sections (reason for contact, history, physical exam with 35 subsections, assessment, plan)
- `basic-soap.ts` — 4 sections (subjective, objective, assessment, plan)

### `src/lib/types.ts`

Key types: `Encounter`, `EncounterStatus`, `EncounterType`, `SupportedLanguage`, `ChunkMatch`, `ProcessAudioResponse`, `GenerateResponse`, `EncounterListResponse`, `CreateEncounterRequest`, `UpdateEncounterRequest`, `EncounterListParams`

## AI Pipeline

End-to-end flow for generating medical notes:

```
Record Audio → Whisper Transcription → Chunk Text → Embed Chunks → Store in DB
                                                                        ↓
Upload Files → Extract Text (PDF/Image/Audio) → Store extracted_text    ↓
                                                                        ↓
Doctor Notes (typed in editor) ─────────────────────────────────────────↓
                                                                        ↓
Generate: embed retrieval query → match_chunks() → top 16 chunks ──────↓
                                                                        ↓
                    Claude Sonnet 4.5 ← [chunks + file texts + notes]   ↓
                            ↓
                    Structured JSON response
                            ↓
                    Build HTML from template
                            ↓
                    Save to visits.soap_note + patient_letter
```

### Retrieval

The generate route uses a **clinical retrieval query** (language-specific) to embed and run cosine similarity against all transcript chunks for the visit. This selects the top 16 most relevant chunks rather than sending the entire transcript.

### Generation Prompts

System prompts enforce:

1. **Grounding** — only use information from transcript chunks, uploaded files, and doctor notes
2. **Output language** — write in the visit's language (except medical terms)
3. **Missing info** — write "Not stated" / "Neuvedene" / "Neuvedeno" for empty sections
4. **Format** — return valid JSON with section IDs as keys + `letter` + `title`

## File Extraction Pipeline

When files are uploaded via `POST /api/encounters/[encounterId]/files`:

| File Type                 | Extraction Method   | Details                                                                                              |
| ------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| PDF (text-based)          | `pdf-parse`         | Uses `PDFParse` class, `getText()` method                                                            |
| PDF (scanned)             | Claude document API | Fallback when pdf-parse returns < 50 chars. Uses `type: 'document'`, `media_type: 'application/pdf'` |
| Image (PNG/JPEG/GIF/WebP) | Claude Vision API   | `type: 'image'`, base64 encoded. OCR prompt asks to preserve structure                               |
| Audio                     | Whisper             | Reuses `transcribeAudio()`                                                                           |

Extracted text is stored in `visit.metadata.files[].extracted_text` and included in the generation context alongside transcript chunks and doctor notes.

## Frontend Architecture

### Pages

- **Dashboard** (`/[locale]/page.tsx`) — Stats (total, started, completed encounters), "New Encounter" CTA
- **Encounter** (`/[locale]/encounters/[visitId]/page.tsx`) — Main working page (see below)
- **Login** (`/[locale]/login/page.tsx`) — Email magic link authentication
- **Settings** (`/[locale]/settings/page.tsx`) — User preferences
- **Templates** (`/[locale]/templates/page.tsx`) — Template browser

### Encounter Page States

The encounter page has two modes based on status:

**Draft Mode** (status: started, recording, processing):

- Sticky header with editable title + RecordingBar
- TemplateSidebar (collapsible sections with progress indicators)
- TipTap editor for doctor notes (auto-save with 2s debounce)
- FilesPanel for drag-and-drop file uploads
- Slash command (`/`) for inserting template section headings

**Review Mode** (status: to_review, completed):

- Tab navigation: Transcript, Note, Add Document
- TemplateSidebar shows which sections are documented
- NoteSectionCard displays parsed note sections
- PatientPanel for patient metadata (blur-save)
- Copy note to clipboard (rich text + plain text)

### State Management

- `activeGenerations` — Module-level `Set<string>` tracking in-progress generations (survives remounts)
- Custom events for cross-component communication:
  - `encounter-update` — Sidebar refreshes encounter list
  - `encounter-delete` — Sidebar removes deleted encounter
  - `generation-done` — Signals generation completion
- `canGenerate` derived state: `!!(visit?.raw_text || audioBlob || doctorNotes.trim() || hasFileContent)`
- Auto-transition to `to_review` status after successful generation

### Key Components

| Component         | Location                                       | Purpose                           |
| ----------------- | ---------------------------------------------- | --------------------------------- |
| AppShell          | `components/nav/app-shell.tsx`                 | Main layout with sidebar          |
| RecordingBar      | `components/encounters/recording-bar.tsx`      | WebAudio recorder with waveform   |
| TipTapEditor      | `components/editor/tiptap-editor.tsx`          | Rich text editor                  |
| SlashCommand      | `components/editor/slash-command.tsx`          | `/` command palette               |
| TemplateSidebar   | `components/encounters/template-sidebar.tsx`   | Collapsible template sections     |
| FilesPanel        | `components/encounters/files-panel.tsx`        | File upload with drag-and-drop    |
| ProcessingOverlay | `components/encounters/processing-overlay.tsx` | Animated spiral during generation |
| PatientPanel      | `components/encounters/patient-panel.tsx`      | Patient metadata form             |
| NoteSectionCard   | `components/encounters/note-section-card.tsx`  | Individual note section display   |
| NavEncounters     | `components/nav/nav-encounters.tsx`            | Infinite scroll encounters list   |

## Templates System

Templates define the structure of generated medical notes.

### Template Types

```typescript
interface TemplateSection {
  id: string; // e.g. "physical_exam"
  labelKey: string; // i18n key: "templates.sections.physical_exam"
  subsections?: TemplateSection[];
}

interface Template {
  id: string; // e.g. "comprehensive-medical-exam"
  nameKey: string; // i18n key for template name
  descriptionKey: string;
  sections: TemplateSection[];
}
```

### Available Templates

1. **comprehensive-medical-exam** (default) — ~50 sections
   - Top: reason_for_contact, past_history, allergies, current_medications, social_history (5 subsections), history_present_illness
   - Physical exam: 35 subsections (vitals, head, eyes, ears, nose, throat, neck, chest, heart, lungs, abdomen, extremities, skin, neurological, mental health, etc.)
   - Lab, radiology, other findings, assessment, action and plan

2. **basic-soap** — 4 sections
   - Subjective, Objective, Assessment, Plan

### HTML Generation

`buildTemplateHtml(template, sectionContents, sectionLabels)` produces structured HTML:

- Top-level sections → `<h2>`
- Subsections → `<h3>`
- Content → `<p>` tags

## Editor

TipTap 3 editor with:

**Extensions:**

- StarterKit (heading levels 2, 3)
- Placeholder
- Custom slash command extension (via `@tiptap/suggestion`)

**Slash Command:**

- Triggered by typing `/`
- Powered by `cmdk` for fuzzy search
- Groups: "Sections" (inserts h2) and "Subsections" (inserts h3)
- Auto-inserts parent heading when adding a subsection
- Keyboard navigation (arrow keys, Enter, Escape)

**Props:**

- `content` — HTML string
- `onChange` — callback with updated HTML
- `placeholder` — placeholder text
- `slashCommandItems` — template sections for the command palette
- `onEditorReady` — exposes editor instance

## Component Architecture

### Generated vs Shared

```
components/
├── generated/ui/    # Raw shadcn components — NEVER edit directly
│   ├── button.tsx
│   ├── card.tsx
│   ├── dialog.tsx
│   └── ...
└── shared/          # Wrappers — all app code imports from here
    ├── button/
    │   ├── index.ts           # Re-exports from generated
    │   ├── button.tsx         # Optional customization
    │   └── button.stories.tsx # Storybook story
    ├── card/
    └── ...
```

**Import pattern:** `import { Button } from "@/components/shared/button"` (never `@/components/ui/`)

**shadcn config** (`components.json`): `"ui": "@/components/generated/ui"` — new shadcn components land in `generated/`.

27 shared component directories including: button, card, dialog, tabs, input, textarea, combobox, command, dropdown-menu, separator, scroll-area, tooltip, badge, etc.

### Storybook

- **Version:** 10.2.15 with `@storybook/nextjs-vite`
- **Stories location:** Alongside wrappers in `src/components/shared/<name>/<name>.stories.tsx`
- **Run:** `npm run storybook` (port 8001)
- **Addons:** chromatic, vitest, a11y, docs, onboarding
- **Preview:** Wraps stories with NextIntlClientProvider (Slovak locale), TooltipProvider, imports `globals.css`

## Testing

### Setup

Vitest 4 with two test projects configured in `vitest.config.ts`:

1. **`storybook`** — Browser tests via Playwright (headless Chromium)
   - Runs Storybook stories as component tests via `@storybook/addon-vitest`
   - Setup: `.storybook/vitest.setup.ts` (applies a11y + project annotations)

2. **`unit`** — jsdom environment
   - Includes: `src/**/*.test.{ts,tsx}`
   - Setup: `src/test/setup.ts` (imports `@testing-library/jest-dom/vitest`)

### Running Tests

```bash
npm test              # Run all tests (unit + storybook)
npm run test:unit     # Run unit tests only
```

### Existing Tests

| Test                   | File                                       | Coverage                                                          |
| ---------------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| `useLocalizedHref`     | `src/hooks/use-localized-href.test.ts`     | Locale prefix logic for default/non-default locales               |
| `useSidebarEncounters` | `src/hooks/use-sidebar-encounters.test.ts` | Fetch, pagination, optimistic delete/markComplete, error handling |

## i18n

### Configuration

- **Locales:** `sk` (default), `cs`, `en`
- **Library:** `next-intl` v4
- **Routing:** `localePrefix: 'as-needed'` — `/` for Slovak, `/cs/...` for Czech, `/en/...` for English
- **Cookie:** `NEXT_LOCALE` (1 year, lax)
- **Detection:** Cookie → Accept-Language header

### Message Namespaces

Messages in `messages/{locale}.json`:

- `common` — Shared labels (save, cancel, delete, etc.)
- `auth` — Login page
- `nav` — Navigation labels
- `encounters` — Encounter page, status labels (`encounters.status.started`, etc.)
- `dashboard` — Dashboard page
- `templates` — Template names, descriptions, section labels (`templates.sections.{sectionId}`)

## Authentication

### Flow

1. User enters email on `/[locale]/login`
2. Supabase sends magic link email
3. User clicks link → redirected to `/auth/callback`
4. Callback exchanges code for session, sets cookies
5. User redirected to dashboard

### API Protection

All API routes use `requireAuth()` from `src/lib/supabase/auth.ts`:

- Creates a server-scoped Supabase client with cookie-based auth
- Calls `supabase.auth.getUser()` to verify session
- Returns `{userId, supabase}` — the Supabase client is scoped to the authenticated user
- Throws `Response(401)` if unauthenticated

### RLS Enforcement

Database-level security:

- **visits:** `auth.uid() = user_id` on all operations
- **transcript_chunks:** JOIN check to parent visit's `user_id`
- **Storage:** Path-based — `storage.foldername(name)[1] = auth.uid()::text`

## Verification

### Full Pipeline Test

1. **Create encounter:** Navigate to dashboard → "New Encounter"
2. **Record audio:** Click record, speak, stop → verify transcription appears
3. **Upload file:** Drop a PDF/image into FilesPanel → verify `extracted_text` is populated (check via `GET /api/encounters/{id}/files`)
4. **Add doctor notes:** Type notes in editor → verify auto-save (2s debounce)
5. **Generate:** Click Generate → verify processing overlay → note appears in Note tab
6. **Verify sources:** Generated note should incorporate transcript + file content + doctor notes
7. **Copy note:** Click copy button → verify clipboard has rich text

### Individual Subsystems

| Subsystem               | How to Verify                                                     |
| ----------------------- | ----------------------------------------------------------------- |
| Auth                    | Log out, visit `/encounters/...` → redirected to login            |
| Transcription           | Upload audio via `POST /api/process-audio` → check `raw_text`     |
| Chunking                | Check `transcript_chunks` table after transcription               |
| Embeddings              | Check `embedding` column is populated (1536 values)               |
| File extraction (PDF)   | Upload text PDF → check `extracted_text` in metadata              |
| File extraction (image) | Upload image with text → check OCR result                         |
| Semantic search         | `POST /api/search` with a query → verify relevant chunks returned |
| Generation              | `POST /api/generate` → verify structured HTML in response         |
| i18n                    | Switch locale → verify UI labels change                           |
| Storybook               | `npm run storybook` → verify components render                    |
| Tests                   | `npm test` → all tests pass                                       |
| Build                   | `npm run build` → no TypeScript errors                            |
