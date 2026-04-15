# MediTalk — End-to-End System Documentation

_Last updated: 2026-04-14_

This document provides a comprehensive overview of how MediTalk works from end to end — authentication through note generation to finalization.

---

## 1. Authentication

- Doctors log in at `/login` via **Supabase OTP** — enter email, receive a 6-digit code (or magic link), verify client-side
- Magic links redirect through `/auth/callback` (PKCE code exchange on server) or `/auth/confirm` (client-side token_hash verification)
- Sessions use Supabase cookies, shared across `.meditalk.ai` subdomains in production
- Admin impersonation is available for support staff via `/api/admin/impersonate`

**Key files:**
- [web/src/app/[locale]/login/page.tsx](<web/src/app/[locale]/login/page.tsx>) — login page with OTP + magic link
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
- [web/src/components/encounters/hooks/use-encounter-generation.ts](web/src/components/encounters/hooks/use-encounter-generation.ts) — streaming orchestration
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

This is the core engine. For the full canonical reference, see [kb/note-generation-engine.md](note-generation-engine.md).

### Inputs gathered:
- Transcript text (from recording)
- Doctor notes (from `metadata.doctor_notes`)
- Extracted file texts (from uploaded images/PDFs/audio)

### Pipeline passes:

| Pass | Model | Purpose |
|------|-------|---------|
| **Pass 1** — Clinical Analysis | Sonnet 4.6 (temp=0) | Match clinical concepts, infer specialty, cluster problems, suggest ICD-10 codes, extract medication names |
| **Pass 1.5** — Fact Extraction | Haiku 4.5 (temp=0) | Extract structured facts into 15 categories (including 6 history subcategories for precise section routing), each with verbatim evidence quote |
| **Pass 1.6a** — Fact Validation | Pure TypeScript | Verify evidence appears in claimed source, fuzzy matching, cross-source fallback, medication correction |
| **Pass 1.6b** — Fact Resolution | Pure TypeScript | Detect speaker self-corrections, drop superseded facts |
| **Pass 1.7** — ICD Certainty Filter | Pure TypeScript | Drop ICD candidates not grounded in diagnoses/history-subcategory facts |
| **Prompt Assembly** | Pure TypeScript | Template specialty override + pre-rendered ICD block (VERBATIM, sorted) + facts pre-assigned to sections (transcript omitted when facts present) |
| **Pass 2** — Generation | Opus 4.6 (temp=0) | Opus as formatter: copies ICD block verbatim, places pre-assigned facts into sections. Streamed via SSE |
| **Pass 2.5** — Post-Generation | Pure TypeScript | Strip ungrounded ICD codes from output, validate title |

### Streaming Protocol (SSE events):

| Event | When |
|-------|------|
| `analysis_complete` | After Pass 1 |
| `facts_extracted` | After Pass 1.5/1.6/1.7 |
| `streaming_start` | Right before Opus starts |
| `section` | Each time a section completes |
| `complete` | Final payload with full note |
| `error` | On failure |

### Persistence (split save):
1. Column update: `encounter_note`, `patient_letter`, `title`, `status: "to_review"`
2. Atomic metadata merge: `clinical_analysis`, `generation_fingerprint`, `generation_history`

**Key files:**
- [web/src/app/api/generate/route.ts](web/src/app/api/generate/route.ts) — main generation endpoint
- [web/src/lib/clinical/pipeline.ts](web/src/lib/clinical/pipeline.ts) — Pass 1 + enriched prompt assembly
- [web/src/lib/clinical/fact-extraction.ts](web/src/lib/clinical/fact-extraction.ts) — Pass 1.5
- [web/src/lib/clinical/fact-validator.ts](web/src/lib/clinical/fact-validator.ts) — Pass 1.6a
- [web/src/lib/clinical/fact-resolver.ts](web/src/lib/clinical/fact-resolver.ts) — Pass 1.6b
- [web/src/lib/clinical/icd-certainty.ts](web/src/lib/clinical/icd-certainty.ts) — Pass 1.7
- [web/src/lib/clinical/fact-section-assigner.ts](web/src/lib/clinical/fact-section-assigner.ts) — deterministic fact-to-section assignment
- [web/src/lib/anthropic.ts](web/src/lib/anthropic.ts) — Pass 2 + prompt builders + Pass 2.5
- [web/src/lib/api/sse.ts](web/src/lib/api/sse.ts) — SSE streaming helpers

---

## 7. Regeneration

Two paths via [web/src/app/api/regenerate/route.ts](web/src/app/api/regenerate/route.ts):

- **Fast reformat** — only template changed → Haiku reformats existing note into new layout, no re-analysis
- **Full path** — content changed → identical pipeline to generate, optionally reuses cached `clinical_analysis` from metadata to skip Pass 1

Fingerprint diffing (SHA-256 over every pipeline component) detects whether differences between runs are from prompt changes (our code) or LLM sampling variance (model noise).

---

## 8. Templates

- **Built-in** (static): SOAP + specialty variants in [web/src/lib/templates/default-templates.ts](web/src/lib/templates/default-templates.ts), marked `isSystem: true`
- **User-defined**: Supabase `templates` table with custom sections, i18n labels, optional style guide, usage tracking
- Each template has hierarchical sections with per-locale labels and optional context/guidance text. Focused templates (Cardiology, Internal Medicine, Neurology) use abbreviated Slovak labels (RA, OA, SA, PA, LA, Ab, TO, etc.) with mandatory `context` fields explaining what content belongs in each section
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

| File Type | Extraction Method | Model |
|-----------|------------------|-------|
| Images | EXIF auto-rotate → Claude Vision | Sonnet 4.6 (temp=0) |
| PDFs | Signed URL → Claude document API | Sonnet 4.6 (temp=0) |
| Audio | Scribe v2 batch transcription | ElevenLabs |

**Two extraction paths:**
1. **Background** (right after upload) — [web/src/app/api/encounters/[encounterId]/extract/route.ts](<web/src/app/api/encounters/[encounterId]/extract/route.ts>)
2. **Inline** (during generation) — if files arrive incomplete, extracted on-demand in the generate route

**Recovery:** Stuck extractions (>5 min) reset to "failed" for retry. RPC persist has 3-attempt retry with backoff.

**Key file:** [web/src/lib/extraction/extract-file.ts](web/src/lib/extraction/extract-file.ts)

---

## 11. Data Model

### Main table: `visits`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Encounter ID |
| `user_id` | uuid (FK) | Doctor |
| `title` | text | Short encounter title |
| `language` | text | sk / cs / en |
| `status` | text | started / recording / processing / to_review / completed / archived |
| `encounter_note` | text | Generated HTML note |
| `patient_letter` | text | Generated HTML letter |
| `metadata` | jsonb | All other data (see below) |

### Metadata JSONB shape:

```jsonc
{
  "transcript": "...",
  "files": [{ "id": "...", "name": "...", "extracted_text": "...", "extraction_status": "completed" }],
  "template_id": "soap_v1",
  "doctor_notes": "...",
  "recording_session": { "state": "paused", "durationAtPause": 127, "audioPath": "..." },
  "generation_pending": { "templateId": "soap_v1", "startedAt": "2026-04-10T12:00:00Z" },
  "clinical_analysis": { "inferredSpecialty": "cardiology", "candidateIcdCodes": [...] },
  "generation_fingerprint": "sha256:...",
  "generation_history": [{ "timestamp": "...", "fingerprint": {...}, "model": "...", "duration_ms": 42300 }]
}
```

All metadata writes go through atomic `merge_visit_metadata` RPC (JSONB `||` merge).

### Other tables:

| Table | Purpose |
|-------|---------|
| `templates` | User-defined templates with i18n, style guide, usage tracking |
| `api_usage` | Per-call token/cost log |
| `audit_logs` | User-action audit trail |
| `transcript_chunks` | Legacy chunk + embedding store (deprecated) |

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

| Page | Purpose |
|------|---------|
| Dashboard | Pricing metrics, cost analysis per model/operation |
| Users | User management (invite, delete, view activity) |
| Templates | Create, edit, visibility toggle, sorting |
| Encounters | View all encounters across users |

---

## 15. API Routes

### Encounters
- `GET/POST /api/encounters` — list / create
- `GET/PATCH/DELETE /api/encounters/[id]` — read / update / delete
- `POST /api/encounters/[id]/files` — file upload
- `POST /api/encounters/[id]/extract` — trigger text extraction

### Generation
- `POST /api/generate` — SSE streaming note generation
- `POST /api/regenerate` — regenerate with same or different template
- `POST /api/batch-transcribe` — batch audio transcription

### Search
- `GET /api/search` — encounter search (Cmd+K)
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

| Pass | Model | Role |
|------|-------|------|
| File OCR (image/PDF) | Sonnet 4.6 (temp=0) | Image + PDF → text |
| Pass 1 — Clinical analysis | Sonnet 4.6 (temp=0) | Concepts, specialty, ICDs, clusters |
| Pass 1.5 — Fact extraction | Haiku 4.5 (temp=0) | Grounded facts with evidence |
| Pass 2 — Generation | Opus 4.6 (temp=0, fallbacks: Sonnet 4.6/4.5/4) | Prose note + letter + title |
| Reformat (regen fast path) | Haiku 4.5 | Template swap |
| Transcription | Scribe v2 (ElevenLabs) | Audio → text |

---

## 17. Key Guarantees

1. **Every fact has verbatim evidence** — Pass 1.5 requires quotes; Pass 1.6a drops unverifiable facts
2. **Every ICD code is grounded and pre-rendered** — Pass 1.7 drops ungrounded candidates; `buildPreRenderedIcdBlock` sorts and formats them; Opus copies the block VERBATIM; Pass 2.5 defensively strips any Opus snuck past
3. **Deterministic pipeline** — LLM non-determinism absorbed by pure-TypeScript gates (1.6a, 1.6b, 1.7, fact-section-assigner, pre-rendered ICD, 2.5). Template specialty overrides Pass 1 inference. Transcript omitted when facts present.
4. **No hallucinated clinical content** — Opus told "validated facts are the factual contract"
5. **Atomic metadata** — concurrent writers can't clobber each other thanks to JSONB merge RPC

---

## 18. Testing

- **617 tests** across the clinical pipeline, hooks, utilities
- Every clinical module has matching `*.test.ts`
- Route-level integration tests for `/api/generate` and `/api/regenerate`
- Lint (ESLint) + Prettier enforced on every commit
- Build verification (`npm run build`) before pushing

---

## 19. Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16, React 19 |
| Styling | Tailwind CSS v4 (PostCSS, OKLch colors) |
| Components | shadcn (radix-nova style), CVA for variants |
| Icons | @hugeicons/react + @hugeicons/core-free-icons |
| i18n | next-intl (sk, cs, en) |
| Auth | Supabase Auth (OTP + magic link) |
| Database | Supabase (PostgreSQL) |
| Storage | Supabase Storage |
| AI — Notes | Anthropic Claude (Opus 4.6, Sonnet 4.6, Haiku 4.5) |
| AI — Transcription | ElevenLabs Scribe v2 |
| Native | Capacitor 8 (iOS + Android) |
| Email | Resend |
| Package manager | pnpm |

---

_For the detailed generation pipeline reference, see [kb/note-generation-engine.md](note-generation-engine.md)._
