# MediTalk POC — Implementation Plan

## Context

MediTalk is a medical transcription POC using Next.js, Supabase, OpenAI (Whisper), and Anthropic (Claude). The foundational setup is done:
- Next.js 16 + Tailwind v4 + shadcn/ui (radix-nova theme, neutral palette, Inter font)
- HugeIcons for iconography
- i18n with `next-intl` (sk/cs/en), `LanguageSwitcher` component, middleware in `src/proxy.ts`
- Supabase clients: browser (`src/lib/supabase/client.ts`) + server (`src/lib/supabase/server.ts`) via `@supabase/ssr`
- Login page with magic link OTP (`src/app/[locale]/login/page.tsx`)
- Auth callback route (`src/app/auth/callback/route.ts`)
- Auth helper `requireAuth()` at `src/lib/supabase/auth.ts`
- Middleware in `src/proxy.ts` (needs to move to project root)
- SQL migration with pgvector, RLS, `match_chunks` function (`supabase/migrations/001_initial_schema.sql`)

What remains: fix middleware location, add sign-out, build core libs + API routes + UI, run migrations.

---

## Phase 0: Supabase Project Setup (Manual Steps)

### 0.1 Create Supabase Project
1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Click **"New Project"**
3. Choose your organization (or create one)
4. Set project name: `meditalk`
5. Set a **database password** (save it somewhere safe)
6. Choose region closest to your users (e.g., `eu-central-1` for EU)
7. Click **"Create new project"** — wait for provisioning (~2 min)

### 0.2 Get API Keys
1. In Supabase dashboard, go to **Settings → API**
2. Copy these values:
   - **Project URL** → `https://xxxxx.supabase.co` → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon (public)** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role (secret)** key → `SUPABASE_SERVICE_ROLE_KEY`
   - ⚠️ The service_role key bypasses RLS — never expose it to the client

### 0.3 Get OpenAI API Key
1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Click **"Create new secret key"** → `OPENAI_API_KEY`

### 0.4 Get Anthropic API Key
1. Go to [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
2. Click **"Create Key"** → `ANTHROPIC_API_KEY`

### 0.5 Configure `.env.local`
Create/update `.env.local` in the project root:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

### 0.6 Run Database Migration
Option A — **Supabase SQL Editor** (easiest):
1. In Supabase dashboard → **SQL Editor**
2. Paste contents of `supabase/migrations/001_initial_schema.sql`
3. Click **"Run"**

Option B — **Supabase CLI**:
```bash
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

### 0.7 Create Storage Bucket
In Supabase **SQL Editor**, run:
```sql
insert into storage.buckets (id, name, public)
values ('audio', 'audio', false);

create policy "Users can upload audio"
  on storage.objects for insert
  with check (
    bucket_id = 'audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can read own audio"
  on storage.objects for select
  using (
    bucket_id = 'audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete own audio"
  on storage.objects for delete
  using (
    bucket_id = 'audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

### 0.8 Configure Auth Settings
1. In Supabase dashboard → **Authentication → URL Configuration**
2. Set **Site URL** to: `http://localhost:8111`
3. Add **Redirect URLs**: `http://localhost:8111/auth/callback`
4. Under **Auth Providers → Email**, ensure:
   - "Enable Email provider" is ON
   - "Enable Magic Link" is ON
   - Optionally set "Minimum password length"

---

## Phase 1: Auth Infrastructure

### 1.1 Install Dependencies
- `openai` (Whisper transcription + embeddings)
- `@anthropic-ai/sdk` (Claude generation)
- shadcn/ui components: `button`, `input`, `card`, `tabs`, `scroll-area`, `alert`, `dropdown-menu`, `skeleton`, `separator`

### 1.2 Move Middleware to Correct Location
Next.js requires middleware at the project root as `middleware.ts` with export named `middleware`.

- Move `src/proxy.ts` → `middleware.ts` (project root)
- Rename exported function from `proxy` to `middleware`
- Update imports (relative paths change since file moves to root)

**Files:** `src/proxy.ts` (DELETE) → `middleware.ts` (CREATE)

### 1.3 Add Sign Out
- Add sign-out via client-side action using Supabase `signOut()`
- Sign-out button in the main page header (built in Phase 4)

---

## Phase 2: Core Libraries

### 2.1 Shared Types
**File:** `src/lib/types.ts`
- `Transcript` type (maps to `transcripts` table)
- `TranscriptChunk` type (maps to `transcript_chunks` table)
- `ChunkMatch` type (search result with similarity score)
- API response types: `ProcessAudioResponse`, `SearchResponse`, `GenerateResponse`
- `SupportedLanguage` type (`'en' | 'sk' | 'cs'`)

### 2.2 Text Chunking
**File:** `src/lib/chunking.ts`
- `chunkText(text: string, chunkSize?: number, overlap?: number): string[]`
- Default: ~1000 chars, ~200 overlap
- Split on sentence/word boundaries, no mid-word breaks

### 2.3 OpenAI Utilities
**File:** `src/lib/openai.ts`
- `transcribeAudio(file: File | Buffer, filename: string): Promise<string>` — Whisper API
- `embedText(text: string): Promise<number[]>` — text-embedding-ada-002, 1536 dims
- `embedTexts(texts: string[]): Promise<number[][]>` — batch embedding

### 2.4 Anthropic Utilities
**File:** `src/lib/anthropic.ts`
- `generateSOAPAndLetter(chunks: string[], language: SupportedLanguage): Promise<{ soap: string, letter: string }>`
- System prompt enforcing strict grounding: only use provided chunks
- "Not stated" / "Neuvedene" / "Neuvedeno" for missing info (localized)
- Output language follows `language` parameter
- Keep proper nouns and medical terms as-is

---

## Phase 3: API Routes

### 3.1 POST `/api/process-audio`
**File:** `src/app/api/process-audio/route.ts`
1. Auth check via `requireAuth()`
2. Parse multipart/form-data (file, title, language)
3. Validate file type/size (max 50MB, audio types)
4. Upload to Supabase Storage: `audio/${userId}/${uuid}-${filename}`
5. Transcribe via Whisper
6. Insert into `transcripts`
7. Chunk transcript text
8. Embed all chunks
9. Insert chunks into `transcript_chunks`
10. Return `{ transcriptId, audioPath, chunkCount, transcriptText }`

### 3.2 POST `/api/search`
**File:** `src/app/api/search/route.ts`
1. Auth check, validate `transcriptId` belongs to user
2. Embed query text
3. Call `match_chunks(embedding, k, transcriptId)`
4. Return `{ matches: [{ chunk_index, content, similarity }] }`

### 3.3 POST `/api/generate`
**File:** `src/app/api/generate/route.ts`
1. Auth check, validate `transcriptId` belongs to user
2. Run semantic search with clinical retrieval query (k=10-16)
3. Pass chunks to Claude with strict grounding prompt
4. Return `{ soap, letter, usedChunks }`

---

## Phase 4: UI

### 4.1 Update i18n Messages
**Files:** `messages/en.json`, `messages/sk.json`, `messages/cs.json`
- Upload/record tab labels, processing states
- Search/generate labels
- SOAP/letter section labels
- Error messages

### 4.2 Main Page
**File:** `src/app/[locale]/page.tsx`
- **Header**: App name + description
- **Top bar**: Language switcher (shadcn DropdownMenu) + user email + Sign Out button
- **Card** with **Tabs**:
  - **Tab 1 "Upload"**: Title input, file input, "Process" button
  - **Tab 2 "Record"**: Title input, Start/Stop buttons, audio preview, "Process recording" button
- **Results area** (shown after processing):
  - Transcript viewer (shadcn ScrollArea)
  - Search box (Input + "Search" button)
  - Chunk match results (Card list with similarity scores)
  - "Generate SOAP + Letter" button
  - Output display: SOAP section + Patient Letter section

### 4.3 Audio Recording Hook
**File:** `src/hooks/useAudioRecorder.ts`
- MediaRecorder integration
- Start/Stop controls
- Returns audio Blob for submission
- Handle mime type detection (webm/ogg fallback)

### 4.4 Loading + Error States
- Skeleton loaders during processing
- Disable buttons during API calls
- shadcn Alert for error display
- HugeIcons throughout: Microphone, Upload, Search, Loading, Check, Alert

---

## Phase 5: Quality + Safety

### 5.1 Error Handling
- All API routes: try/catch with structured error responses, no PHI leakage
- Client: user-facing error messages via Alert component

### 5.2 Security
- Never expose `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` to client
- All DB operations use authenticated user-scoped Supabase client (RLS enforced)
- File upload validation: type allowlist + 50MB size limit

### 5.3 Strict Grounding
- Claude system prompt explicitly forbids inventing information
- If a SOAP field has no supporting chunk data, output localized "Not stated"
- `usedChunks` returned so UI can show what was referenced

---

## File Tree (New + Modified)

```
meditalk/
├── middleware.ts                             # NEW (moved from src/proxy.ts)
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql           # EXISTS
├── src/
│   ├── app/
│   │   ├── [locale]/
│   │   │   ├── layout.tsx                   # EXISTS
│   │   │   ├── page.tsx                     # REWRITE (full POC UI)
│   │   │   └── login/
│   │   │       └── page.tsx                 # EXISTS (magic link login)
│   │   ├── auth/
│   │   │   └── callback/
│   │   │       └── route.ts                 # EXISTS (auth callback)
│   │   └── api/
│   │       ├── process-audio/
│   │       │   └── route.ts                 # NEW
│   │       ├── search/
│   │       │   └── route.ts                 # NEW
│   │       └── generate/
│   │           └── route.ts                 # NEW
│   ├── components/
│   │   ├── language-switcher.tsx             # MODIFY (use shadcn DropdownMenu)
│   │   └── ui/                              # NEW (shadcn components)
│   │       ├── button.tsx
│   │       ├── input.tsx
│   │       ├── card.tsx
│   │       ├── tabs.tsx
│   │       ├── scroll-area.tsx
│   │       ├── alert.tsx
│   │       ├── dropdown-menu.tsx
│   │       ├── skeleton.tsx
│   │       └── separator.tsx
│   ├── hooks/
│   │   └── useAudioRecorder.ts              # NEW
│   ├── lib/
│   │   ├── types.ts                         # NEW
│   │   ├── chunking.ts                      # NEW
│   │   ├── openai.ts                        # NEW
│   │   ├── anthropic.ts                     # NEW
│   │   ├── supabase/
│   │   │   ├── client.ts                    # EXISTS
│   │   │   ├── server.ts                    # EXISTS
│   │   │   └── auth.ts                      # EXISTS (API route auth helper)
│   │   └── utils.ts                         # EXISTS
│   ├── i18n/
│   │   ├── routing.ts                       # EXISTS
│   │   └── request.ts                       # EXISTS
│   └── proxy.ts                             # DELETE (moved to root middleware.ts)
├── messages/
│   ├── en.json                              # MODIFY (add POC strings)
│   ├── sk.json                              # MODIFY (add POC strings)
│   └── cs.json                              # MODIFY (add POC strings)
├── .env.local                               # MODIFY (add new env vars)
└── package.json                             # MODIFY (new dependencies)
```

---

## Implementation Order

1. **Phase 0** — Manual Supabase setup (project, keys, migration, storage bucket, auth config)
2. **Phase 1** — Auth infra (deps, middleware move, sign out)
3. **Phase 2** — Core libs (pure functions, easy to build + test in isolation)
4. **Phase 3** — API routes (depend on Phase 2 libs)
5. **Phase 4** — UI (depends on Phase 3 APIs being ready)
6. **Phase 5** — Quality pass (review + harden everything)

---

## Verification
1. `npm run dev` → runs on port 8111
2. Visit `/login` → magic link flow works end-to-end
3. After login → main page loads, user email shown, sign out works
4. Upload audio → transcript appears, chunks created
5. Search → returns relevant chunks with similarity scores
6. Generate → SOAP note + patient letter appear
7. Dark/light mode both render correctly
8. Language switcher works (sk/cs/en)
