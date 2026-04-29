# MediTalk — End-to-End System Documentation

_Last updated: 2026-04-28_

This document provides a comprehensive overview of how MediTalk works from end to end — authentication through note generation to finalization.

## What's new (2026-04-28)

- **Pipeline consolidation** — 3 route handlers collapsed to 2 (`/api/generate` + `/api/adjust`); `/api/regenerate` deleted (absorbed into `/api/generate` cached mode). Shared orchestration extracted into `web/src/lib/pipeline/` (resolve-source, session, persist, adjust-helpers). 41 new tests.
- **God hook decomposed** — the 1,436-line `use-encounter-generation.ts` split into 3 focused hooks: `use-doctor-notes.ts` (auto-save), `use-generation-stream.ts` (SSE streaming), `use-pre-generation.ts` (recording finalization + transcription). The coordinator hook composes them (~430 lines).
- **`POST /api/adjust`** — incremental mid-visit updates. Router Haiku decides which sections to re-render; unchanged sections keep content from `visit.metadata.section_contents`.
- **File context dialog** — Actual / Past radio. "Actual" = whole file used; "Past" = user must type what to distill (Haiku pre-filters). See [data-extraction.md](data-extraction.md).
- **Critic via tool-use** — section critic now uses `tool_choice: submit_corrected_section`, eliminating essay / meta-commentary leaks structurally.
- **Eval harness on 3 real doctor-corrected fixtures** (`npm run eval`): Mordavská, Kovačiková, Gozora.

---

## 1. Authentication

- Doctors log in at `/login` via **Supabase OTP** — enter email, receive a 6-digit code (or magic link), verify client-side
- Magic links redirect through `/auth/callback` (PKCE code exchange on server) or `/auth/confirm` (client-side token_hash verification)
- Sessions use Supabase cookies, shared across `.meditalk.ai` subdomains in production
- Admin impersonation is available for support staff via `/api/admin/impersonate`

**Key files:**

- [web/src/app/[locale]/login/page.tsx](web/src/app/[locale]/login/page.tsx) — login page with OTP + magic link
- [web/src/app/auth/callback/route.ts](web/src/app/auth/callback/route.ts) — PKCE code exchange
- [web/src/app/auth/confirm/page.tsx](web/src/app/auth/confirm/page.tsx) — client-side token_hash verification
- [web/src/lib/supabase/client.ts](web/src/lib/supabase/client.ts) — browser Supabase client

---

## 2. App Shell & Navigation

Authenticated pages are wrapped in **AppShell** — a sidebar + header layout.

**Sidebar** shows:

- New Encounter button + Command search (Cmd+K)
- Nav links: Home (dashboard), Templates
- Scrollable encounter list split into "Ongoing" (started/recording/processing/to_review) and "Completed"
- User menu at bottom

**Header** has breadcrumbs + dynamic page actions (portaled from each page component).

Sidebar updates in realtime via CustomEvents (`encounter-update`, `encounter-delete`, `sidebar-refresh`).

**Key files:**

- [web/src/components/nav/app-shell.tsx](web/src/components/nav/app-shell.tsx) — SidebarProvider + AppSidebar + Header + content
- [web/src/components/nav/app-sidebar.tsx](web/src/components/nav/app-sidebar.tsx) — brand, nav, encounter list, user menu
- [web/src/components/nav/header.tsx](web/src/components/nav/header.tsx) — breadcrumbs + portaled actions
- [web/src/components/nav/nav-encounters.tsx](web/src/components/nav/nav-encounters.tsx) — infinite-scroll encounter list

---

## 3. Dashboard (Home Page)

- Shows encounter statistics: total count, minutes saved, time period filter
- Displays the doctor's top 4 most-used templates as quick-start cards
- "New encounter" button in the header

**Key file:** [web/src/app/[locale]/(app)/page.tsx](<web/src/app/[locale]/(app)/page.tsx>)

---

## 4. Creating an Encounter

- `useCreateEncounter` hook → POST `/api/encounters` with optional `template_id`
- Creates a new `visits` row with `status: "started"`, navigates to `/encounters/[id]`
- Sidebar dispatches `sidebar-refresh` to show the new encounter immediately

**Entry points:**

1. "New Encounter" button in header (HomePage, NavMain)
2. Template "Use" buttons (HomePage, TemplateDetailPage)

**Key files:**

- [web/src/hooks/use-create-encounter.ts](web/src/hooks/use-create-encounter.ts)
- [web/src/app/api/encounters/route.ts](web/src/app/api/encounters/route.ts) — POST handler

---

## 5. The Encounter Page — Three Modes

The main page at `/encounters/[visitId]` is where all the work happens. It has three views based on encounter status.

**Key file:** [web/src/app/[locale]/(app)/encounters/[visitId]/page.tsx](<web/src/app/[locale]/(app)/encounters/[visitId]/page.tsx>)

### 5a. Draft View (status: `started` or `recording`)

**Recording Bar** — the main input method:

- Doctor presses record → `useAudioRecorder` starts a `MediaRecorder` (web) or Capacitor PCM plugin (native)
- On **pause**: snapshot blob is uploaded to Supabase storage + fire-and-forget batch transcription via ElevenLabs Scribe v2 → result saved to `metadata.transcript` for live preview
- On **mp4/Safari**: `requestData()` is skipped to prevent container corruption; no pause-time upload, but `stop()` captures everything in one clean blob
- Session state (duration, audio path) is persisted to `metadata.recording_session` so it survives page refresh
- On **resume after refresh**: a fresh recorder starts with `durationOffset` so the timer continues; pre-refresh audio is at the stored `audioPath`

**Doctor Notes** — free-text area with 2-second debounced auto-save to `metadata.doctor_notes`, plus blur-save. Visual save status indicator (saving/saved/error).

**Files Panel** (right side) — upload images, PDFs, audio files:

- Uploaded to `encounter-files` Supabase bucket via signed URLs
- Background extraction fires immediately: images → Claude Vision (Sonnet), PDFs → Claude document API, audio → Scribe v2
- Extraction status tracked per file (`pending → extracting → completed/failed`)
- Generation is blocked while files are still uploading

**Template Selector** — choose which note template to use (SOAP, specialty variants, or custom user templates).

**Key files:**

- [web/src/components/encounters/recording-bar.tsx](web/src/components/encounters/recording-bar.tsx) — recording UI, pause-time upload, session persistence
- [web/src/components/encounters/hooks/use-audio-recorder.ts](web/src/components/encounters/hooks/use-audio-recorder.ts) — web + native recording abstraction
- [web/src/components/encounters/files-panel.tsx](web/src/components/encounters/files-panel.tsx) — file upload + extraction tracking
- [web/src/hooks/use-save-status.ts](web/src/hooks/use-save-status.ts) — auto-save state machine

### 5b. Processing Overlay (status: `processing`)

When the doctor hits **Generate**:

1. Recording finalizes → full blob returned
2. Client-side batch transcription via Scribe v2 (20-60s)
3. `POST /api/generate` with transcript text + metadata
4. Overlay shows progressive SSE events: analysis complete → facts extracted → streaming sections

**Recovery mechanisms:**

- If the page is navigated away during generation, `useGenerationPolling` polls every 3s when `status === "processing"` and SSE isn't active
- 3-minute timeout resets status to "started" + auto-resumes generation once
- Stale generation detection on page load: if `generation_pending.startedAt` > 3 min, resets to "started"

**Key files:**

- [web/src/components/encounters/hooks/use-encounter-generation.ts](web/src/components/encounters/hooks/use-encounter-generation.ts) — coordinator hook (composes the three hooks below)
- [web/src/components/encounters/hooks/use-generation-stream.ts](web/src/components/encounters/hooks/use-generation-stream.ts) — SSE streaming consumer, module-level caches, client retry
- [web/src/components/encounters/hooks/use-pre-generation.ts](web/src/components/encounters/hooks/use-pre-generation.ts) — recording finalization, blob upload, transcription
- [web/src/components/encounters/hooks/use-doctor-notes.ts](web/src/components/encounters/hooks/use-doctor-notes.ts) — 2s debounced auto-save with retry
- [web/src/components/encounters/hooks/use-generation-polling.ts](web/src/components/encounters/hooks/use-generation-polling.ts) — recovery polling
- [web/src/components/encounters/hooks/use-encounter-data.ts](web/src/components/encounters/hooks/use-encounter-data.ts) — status auto-corrections

### 5c. Review View (status: `to_review`)

- Generated note displayed as editable HTML sections
- ICD Panel (right side) shows extracted ICD-10 codes with descriptions
- Doctor can:
  - **Edit sections inline** — changes saved via the editing hook
  - **Edit metadata** — title, patient name/ID, visit type
  - **Regenerate** — full pipeline re-run, or fast reformat if only template changed
  - **Finalize** → status becomes `"finalized"`
  - **Export** — PDF or email dispatch via Resend

**Key files:**

- [web/src/components/encounters/hooks/use-section-editing.ts](web/src/components/encounters/hooks/use-section-editing.ts) — inline section editing
- [web/src/lib/email/send-note-email.ts](web/src/lib/email/send-note-email.ts) — email dispatch

---

## 6. The Generation Pipeline (Server-Side)

This is the core engine. For the full canonical reference, see [prompt-pipeline.md](prompt-pipeline.md).

### Inputs gathered:

- Transcript text (from recording)
- Doctor notes (from `metadata.doctor_notes`)
- Extracted file texts (from uploaded images/PDFs/audio) with optional per-file `context` (the upload dialog's "focus on …" input)

### Pipeline stages:

| Stage                               | Engine                    | Purpose                                                                                                                                                                                                                                    |
| ----------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Stage 1** — PHI Scrub             | Pure TypeScript           | Strip patient name (when known), rodné číslo, phone, email, PSČ+city, slash-notation addresses. Clinical values (BP, GCS, pupils, dose schedules) protected by contextual guards.                                                          |
| **Stage 2a** — ICD suggester        | Claude Haiku              | One-shot call producing 10–15 CSV-validated ICD-10 candidates. Runs in parallel with §2b. Output feeds both the right-side "Navrhované kódy" panel AND the Záver section.                                                                  |
| **Stage 2b** — Section-agent loop   | Claude (Haiku by default) | Walks template leaves in order, skipping the Záver leaf (fed by 2a). Each section-agent call: role + template worldview + `# Voice examples` (corpus) + section contract; user message contains the source.                                |
| **Stage 2c** — Critic pass (opt-in) | Claude Haiku              | For sections with `critic: true` (HPI/TO, OA, Záver), a second Haiku call audits the draft against the source: removes invention, adds missed facts, preserves voice. Runs in parallel in the background; emits an update via `onSection`. |
| **Stage 2d** — Reconcilers          | Pure TypeScript           | Post-critic transforms per section: `drug-normalizer` (alias map + fuzzy match against medication CSV), `icd-validator` (canonical swap + CM rejection + duplicate-parenthetical guard).                                                   |
| **Stage 3** — Záver injection       | Pure TS + Haiku           | `formatZaverFromSuggestions` joins the ranked codes into a comma-separated line with optional differential clause on a symptom-code primary. Passed through the critic (if enabled on Záver) + `icd-validator` reconciler.                 |
| **Stage 4** — HTML assembly         | Pure TypeScript           | `buildTemplateHtml` concatenates rendered section contents into the final HTML note (empty sections hidden by `skipEmpty`).                                                                                                                |

Clinical knowledge lives in three places: `template.styleExamples` (reference-notes corpus, few-shot), `template.systemPrompt` (template-wide worldview), and `section.context` (per-section contract — also fed verbatim to the critic pass). Per-section flags on the template: `model`, `critic`, `reconcilers`.

### Streaming Protocol (SSE events):

| Event             | When                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `streaming_start` | Start of generation — carries `sectionIds` + `sectionLabels`                                                                                |
| `section`         | Each time a section's state changes. First emit = raw draft; second emit (for critic-enabled sections) = corrected text. UI replaces by id. |
| `complete`        | Final payload: `generatedNote`, `templateId`, `clinicalAnalysis.suggestedIcdCodes`                                                          |
| `error`           | On failure                                                                                                                                  |

### Persistence:

1. Column update: `encounter_note`, `status: "to_review"`
2. Atomic metadata merge: `template_id`, raw `transcript` / `doctor_notes`, `clinical_analysis.suggestedIcdCodes`

**Key files:**

- [web/src/lib/pipeline/resolve-source.ts](../web/src/lib/pipeline/resolve-source.ts) — source pre-processing (audio recovery, extraction, PHI scrub, file-text assembly)
- [web/src/lib/pipeline/session.ts](../web/src/lib/pipeline/session.ts) — shared orchestration core (file-focus → skeleton ∥ ICD → sections → Záver → HTML)
- [web/src/lib/pipeline/persist.ts](../web/src/lib/pipeline/persist.ts) — shared persistence (column update + metadata merge + lost-note logging)
- [web/src/lib/pipeline/adjust-helpers.ts](../web/src/lib/pipeline/adjust-helpers.ts) — adjust utilities (router input, vital-group expansion, Záver decision)
- [web/src/app/api/generate/route.ts](../web/src/app/api/generate/route.ts) — thin route shell (fresh + cached modes, replaces deleted `/api/regenerate`)
- [web/src/app/api/adjust/route.ts](../web/src/app/api/adjust/route.ts) — thin route shell (delta pipeline)
- [web/src/lib/phi-scrubber.ts](../web/src/lib/phi-scrubber.ts) — deterministic PHI regex
- [web/src/lib/sections/suggest-icd.ts](../web/src/lib/sections/suggest-icd.ts) — ICD-10 suggester
- [web/src/lib/sections/format-zaver.ts](../web/src/lib/sections/format-zaver.ts) — suggester → Záver formatter
- [web/src/lib/sections/pipeline.ts](../web/src/lib/sections/pipeline.ts) — section-loop orchestrator (skips Záver leaf, exports `findZaverSection` + `runCriticAndReconcilers`)
- [web/src/lib/sections/section-agent.ts](../web/src/lib/sections/section-agent.ts) — `renderSection` (injects `# Voice examples` block, includes `isAbsenceDescription` safety net)
- [web/src/lib/sections/critic.ts](../web/src/lib/sections/critic.ts) — `criticPass` (opt-in per section, audits draft against source)
- [web/src/lib/sections/reconcilers/index.ts](../web/src/lib/sections/reconcilers/index.ts) — `drug-normalizer`, `icd-validator`
- [web/src/lib/templates/reference-notes.ts](../web/src/lib/templates/reference-notes.ts) — corpus parser / example-map builder
- [web/src/lib/templates/html.ts](../web/src/lib/templates/html.ts) — `buildTemplateHtml`
- [web/src/lib/parse-note-sections.ts](../web/src/lib/parse-note-sections.ts) — HTML → per-section map (label-based matching — fixes cascade shift when `skipEmpty` drops a middle subsection)
- [web/src/lib/api/sse.ts](../web/src/lib/api/sse.ts) — SSE streaming helpers

See [prompt-pipeline.md](prompt-pipeline.md) for the deep dive.

---

## 7. Regeneration (via `/api/generate` cached mode)

The `/api/regenerate` route was deleted. Regeneration is now handled by `/api/generate` in **cached mode** — auto-detected when the client omits `transcriptText` and `audioPath`. Reads the visit's cached raw source (`metadata.transcript`, `metadata.doctor_notes`, `metadata.files[].extracted_text`) and runs the same `runPipelineSession()` with a possibly-new template. No special rerender/reformat branches — one path.

---

## 8. Templates

- **Built-in** (static): SOAP + specialty variants in [web/src/lib/templates/default-templates.ts](web/src/lib/templates/default-templates.ts), marked `isSystem: true`
- **User-defined**: Supabase `templates` table with custom sections, i18n labels, optional style guide, usage tracking
- Each template has hierarchical sections with per-locale labels and mandatory `context` fields (English) explaining what content belongs in each section. All 8 system templates have context on every section and subsection (added via migration `20260416_add_global_section_contexts.sql`, refined by `20260419_fix_oa_la_section_contexts.sql` and `20260420_fix_la_ea_section_contexts.sql`). Key routing rules: OA (past medical history) explicitly excludes medications; LA (current medications) is the sole location for all drug names and dosing, including emergency/administered medications; EA (epidemiological history) explicitly excludes allergy content. Focused templates use abbreviated Slovak labels (RA, OA, SA, PA, LA, Ab, TO, etc.)
- `resolveTemplate(id)` looks up DB first → static fallback → default SOAP

**Key files:**

- [web/src/lib/templates/index.ts](web/src/lib/templates/index.ts) — resolution logic
- [web/src/lib/templates/types.ts](web/src/lib/templates/types.ts) — Template and TemplateSection interfaces

### 8a. User Template Editor (planned)

Doctors will be able to create and customize their own templates directly in the web app — similar to the admin template editor but scoped to their own account and without access to the system prompt.

**Capabilities:**

- **Create from scratch or clone** — start with a blank template or duplicate a built-in/system template as a starting point (`sourceTemplateId` tracks lineage)
- **Section management** — add, remove, rename, and reorder top-level sections and subsections via drag-and-drop
- **Per-section context** — optional guidance text per section (`TemplateSection.context`) that tells the LLM what content belongs there, what to emphasize, what to exclude
- **Style and tone controls** — configure `styleGuide` (free-text style instructions, e.g. "Use formal medical language", "Keep sentences short and direct", "Write in third person") and `styleExamples` (name + text pairs showing desired output style for reference)
- **i18n labels** — section labels are per-locale (`labels: Record<string, string>`) so templates work across sk/cs/en
- **No system prompt access** — the `systemPrompt` field is only editable by admins. User templates inherit the default clinical system prompt. This keeps the core pipeline behavior consistent while letting doctors shape structure and style.

**What users CANNOT change:**

- The main system prompt (clinical rules, source priority, fact grounding)
- Pipeline passes or model selection
- Built-in/system templates (read-only; can be cloned)

**Data model:** User templates live in the same `templates` table with `user_id` set (system templates have `user_id: null`). RLS ensures doctors only see their own templates + system templates.

---

## 9. Transcription

All transcription uses **ElevenLabs Scribe v2** (not Whisper) — better SK/CS accuracy.

- Client-side helper: [web/src/components/encounters/hooks/transcribe-blob.ts](web/src/components/encounters/hooks/transcribe-blob.ts) — single retry with 2s delay for transient errors
- Server endpoint: [web/src/app/api/batch-transcribe/route.ts](web/src/app/api/batch-transcribe/route.ts)
- Upload filename derived from blob's actual MIME type (`audio/mp4` → `.m4a`, not `.webm`) — critical for Safari

**Transcript flow:**

1. Normal: record → finalize → full blob → transcribe → text sent to `/api/generate`
2. Restored session (page refresh): pre-refresh audio at `audioPath` in storage + post-refresh blob transcribed separately; server prepends pre-refresh transcript
3. No blob: falls back to `metadata.transcript` (from pause-time transcription) or doctor notes + files alone

---

## 10. File Upload & Extraction

Files uploaded through signed URLs to `encounter-files` Supabase bucket.

| File Type | Extraction Method                | Model               |
| --------- | -------------------------------- | ------------------- |
| Images    | EXIF auto-rotate → Claude Vision | Sonnet 4.6 (temp=0) |
| PDFs      | Signed URL → Claude document API | Sonnet 4.6 (temp=0) |
| Audio     | Scribe v2 batch transcription    | ElevenLabs          |

**Two extraction paths:**

1. **Background** (right after upload) — [web/src/app/api/encounters/[encounterId]/extract/route.ts](web/src/app/api/encounters/[encounterId]/extract/route.ts)
2. **Inline** (during generation) — if files arrive incomplete, extracted on-demand in the generate route

**Recovery:** Stuck extractions (>5 min) reset to "failed" for retry. RPC persist has 3-attempt retry with backoff.

**Key file:** [web/src/lib/extraction/extract-file.ts](web/src/lib/extraction/extract-file.ts)

---

## 11. Data Model

### Main table: `visits`

| Column           | Type      | Description                                                         |
| ---------------- | --------- | ------------------------------------------------------------------- |
| `id`             | uuid (PK) | Encounter ID                                                        |
| `user_id`        | uuid (FK) | Doctor                                                              |
| `title`          | text      | Short encounter title                                               |
| `language`       | text      | sk / cs / en                                                        |
| `status`         | text      | started / recording / processing / to_review / completed / archived |
| `encounter_note` | text      | Generated HTML note                                                 |
| `metadata`       | jsonb     | All other data (see below)                                          |

### Metadata JSONB shape:

```jsonc
{
  "transcript": "...",
  "files": [
    {
      "id": "...",
      "name": "...",
      "extracted_text": "...",
      "extraction_status": "completed",
    },
  ],
  "template_id": "soap_v1",
  "doctor_notes": "...",
  "recording_session": {
    "state": "paused",
    "durationAtPause": 127,
    "audioPath": "...",
  },
  "generation_pending": {
    "templateId": "soap_v1",
    "startedAt": "2026-04-10T12:00:00Z",
  },
}
```

Legacy keys (`clinical_analysis`, `generation_fingerprint`, `generation_history`, `validated_facts`) may still appear on older visits from the previous pipeline — ignored by the current code but harmless to leave in place.

All metadata writes go through atomic `merge_visit_metadata` RPC (JSONB `||` merge).

### Other tables:

| Table               | Purpose                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `templates`         | User-defined templates with i18n, style guide, usage tracking                                                                                                                                                                               |
| `api_usage`         | Per-call token/cost log; aggregated via SQL RPCs (`aggregate_usage_by_user`, `aggregate_usage_by_visit`, `get_dashboard_usage_totals`, `aggregate_usage_by_model`, `aggregate_usage_by_operation`) to avoid Supabase 1000-row default limit |
| `audit_logs`        | User-action audit trail                                                                                                                                                                                                                     |
| `transcript_chunks` | Inert legacy chunk + embedding store. No application code reads or writes it; pgvector extension + table + `match_chunks` RPC remain available as primitives for future retrieval work                                                      |

### Storage:

- `encounter-files` bucket — uploaded images/PDFs/audio, RLS scoped to owning user

### Status flow:

```
started → recording → processing → to_review → completed/archived
```

---

## 12. Internationalization

- `next-intl` with three locales: **sk** (Slovak, default), **cs** (Czech), **en** (English)
- `localePrefix: "as-needed"` — Slovak URLs have no prefix, others get `/cs/` or `/en/`
- All prompts, clinical concepts, regional terms, ICD descriptions, and UI strings are locale-aware
- Language persisted per encounter in `visits.language`

**Key files:**

- [web/src/i18n/routing.ts](web/src/i18n/routing.ts) — locale config
- [web/src/i18n/request.ts](web/src/i18n/request.ts) — message loading
- `web/messages/{sk,cs,en}.json` — UI translations

**Adding a new locale (de/fr/pl/…) or specialty (neurology/psychiatry/internal)** — see the dedicated [**"Adding a new locale or specialty"**](prompt-pipeline.md#adding-a-new-locale-or-specialty--what-to-touch) section in `prompt-pipeline.md`. It maps every locale- or specialty-coupled surface in the codebase (auto-portable / admin-editable / hand-maintained) and gives two checklists: one for locales, one for specialties. Use it as the single source of truth for expansion work.

---

## 13. Native App (Capacitor 8)

- Wraps the Next.js app via remote dev server (not static export)
- **HTTPS required** for `getUserMedia` — `mkcert` certs for local dev
- Android: `@capawesome-team/capacitor-android-foreground-service` for background mic
- iOS: `UIBackgroundModes: audio` for background mic
- `NativeLifecycle` component handles splash screen + app state
- Platform detection via `isNative`/`isIOS`/`isAndroid`/`isWeb`

**Key files:**

- [web/src/lib/platform.ts](web/src/lib/platform.ts) — platform detection
- [web/src/lib/native-guards.ts](web/src/lib/native-guards.ts) — foreground service start/stop

---

## 14. Admin App

Separate Next.js app at `admin/`:

| Page       | Purpose                                                                                                                                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard  | Pricing metrics, cost analysis per model/operation                                                                                                                                                                                                                    |
| Users      | User management (invite, delete, view activity)                                                                                                                                                                                                                       |
| Templates  | Create, edit, visibility toggle, sorting. Template editor includes **Reference Notes Corpus** panel — upload real attending notes (PDF/image/text) → PHI-scrubbed → persisted to `templates.style_examples` jsonb → injected as few-shot examples at generation time. |
| Encounters | View all encounters across users                                                                                                                                                                                                                                      |

**Reference-notes ingestion** (template editor → Corpus panel → "Add note"):

1. File POSTed to `/api/templates/analyze-note` (admin).
2. [`admin/lib/file-extraction.ts`](admin/lib/file-extraction.ts) extracts text (PDF/image via Sonnet vision, plain text direct).
3. [`admin/lib/phi-scrubber.ts`](admin/lib/phi-scrubber.ts) strips rodné číslo, phone, email, PSČ+city.
4. Response includes `proposedExample: { name, text }` + Claude-detected section labels.
5. Client-side preview ([`admin/lib/reference-notes-parser.ts`](admin/lib/reference-notes-parser.ts)) matches extracted sections against the current template's labels and shows a per-section capture table.
6. On confirm, `style_examples` array is updated + saved via `PATCH /api/templates/[id]` (validates shape: `{name, text}[]`, each `text.length ≤ 20000`, max 50 entries).

---

## 15. API Routes

### Encounters

- `GET/POST /api/encounters` — list / create
- `GET/PATCH/DELETE /api/encounters/[id]` — read / update / delete
- `POST /api/encounters/[id]/files` — file upload
- `POST /api/encounters/[id]/extract` — trigger text extraction

### Generation

- `POST /api/generate` — SSE streaming note generation (fresh mode with `transcriptText`/`audioPath`, or cached mode without them for regeneration)
- `POST /api/adjust` — incremental re-render of affected sections after mid-visit changes
- `POST /api/batch-transcribe` — batch audio transcription

### Lookup

- `GET /api/icd-search` — ICD-10 code search
- `GET /api/icd-resolve` — resolve ICD codes
- `GET /api/medication-search` — medication autocomplete

### Templates

- `GET /api/templates` — all templates
- `GET /api/templates/[id]` — single template
- `POST /api/templates/usage` — track template usage

### Admin

- `POST /api/admin/impersonate` — impersonate users
- `GET /api/admin/impersonate/status` — check impersonation status
- `GET /api/auth/admin-check` — verify admin role

### Other

- `POST /api/send-note-email` — email generated notes

---

## 16. Model Map

| Call                             | Model                                               | Role                                          |
| -------------------------------- | --------------------------------------------------- | --------------------------------------------- |
| File OCR (image/PDF)             | Sonnet 4.6 (temp=0)                                 | Image + PDF → text                            |
| Section-agent (per leaf section) | Haiku 4.5 by default; per-section override possible | Render ONE section from raw source + contract |
| Transcription                    | Scribe v2 (ElevenLabs)                              | Audio → text                                  |

Section-agent model is configurable per template via `section.model: "haiku" | "sonnet" | "opus"`. Defaults to Haiku for speed and cost. Upgrade only where a section's contract demonstrably benefits from a larger model.

---

## 17. Key Guarantees

1. **Single source of truth per section** — the admin-editable `section.context` IS the clinical contract. Change the prose → change behavior; no code deploy needed.
2. **Cross-section consistency** — each section receives all prior-rendered sections as context, so later sections dedup against earlier ones. Each `context` also declares explicit exclusions ("NEVER include X here — belongs to Y").
3. **No invented content** — every section-agent prompt includes "use ONLY facts present in the raw source below. No invention." Reconcilers can add stricter post-checks (e.g. `icd-validator` to canonicalize ICD descriptions).
4. **No PHI reaches LLMs** — `scrubPhi` runs on raw source before any section-agent call.
5. **Per-section error isolation** — if one section's render fails, the pipeline logs and continues with an empty content for that section. The note still ships with all successful sections.
6. **Atomic metadata** — concurrent writers can't clobber each other thanks to the JSONB merge RPC.

---

## 18. Testing

- **570+ tests** across utilities, hooks, pipeline modules, and parsers
- Lint (ESLint) + Prettier enforced on every commit
- Build verification (`npm run build`) before pushing
- A live end-to-end section-agent proof lives at [web/src/lib/sections/la-proof.test.ts](../web/src/lib/sections/la-proof.test.ts), gated behind `LIVE_LLM=1` — runs a real Anthropic call against a fixture transcript and prints the LA + OA sections

---

## 19. Tech Stack Summary

| Layer              | Technology                                         |
| ------------------ | -------------------------------------------------- |
| Framework          | Next.js 16, React 19                               |
| Styling            | Tailwind CSS v4 (PostCSS, OKLch colors)            |
| Components         | shadcn (radix-nova style), CVA for variants        |
| Icons              | @hugeicons/react + @hugeicons/core-free-icons      |
| i18n               | next-intl (sk, cs, en)                             |
| Auth               | Supabase Auth (OTP + magic link)                   |
| Database           | Supabase (PostgreSQL)                              |
| Storage            | Supabase Storage                                   |
| AI — Notes         | Anthropic Claude (Opus 4.6, Sonnet 4.6, Haiku 4.5) |
| AI — Transcription | ElevenLabs Scribe v2                               |
| Native             | Capacitor 8 (iOS + Android)                        |
| Email              | Resend                                             |
| Package manager    | pnpm                                               |

---

_For the detailed generation pipeline reference, see [kb/note-generation-engine.md](note-generation-engine.md)._
