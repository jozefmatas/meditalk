# Architecture Deepening — Pipeline Consolidation

## Context

The codebase has 5 architectural friction points identified by the `/improve-codebase-architecture` skill:

1. Three route handlers (`generate`, `regenerate`, `adjust`) duplicate pipeline orchestration (skeleton, ICD, sections, Záver, HTML, persistence)
2. A 1,436-line god hook (`use-encounter-generation`) owns 11+ concerns with zero tests
3. Recording finalization/upload/transcription logic is buried inside the god hook
4. The generate route bundles 260 lines of audio recovery + extraction pre-processing
5. Zero tests on all orchestration modules (pipeline, routes, god hook)

**Goal:** Collapse 3 routes into 2, extract shared orchestration into a deep pipeline session module, split the god hook into focused hooks, and add tests at the new interfaces.

**Agreed constraints:**
- Delete `/api/regenerate` — template swap calls `/api/generate` with cached source
- Only two routes: `POST /api/generate` (full pipeline) and `POST /api/adjust` (delta pipeline)
- Template cache stays on client
- `section_contents` always persisted by both routes
- One-shot refactor (main is stable)

---

## New Modules

### Server-side

#### `web/src/lib/pipeline/resolve-source.ts`
Extracts pre-processing from generate/route.ts lines 94-469.

```ts
export interface ResolveSourceInput {
  supabase: SupabaseClient;
  userId: string;
  visitId: string;
  language: SupportedLanguage;
  transcriptText?: string;      // from client-side transcription
  doctorNotes?: string;
  audioPath?: string;            // audio recovery path
  visit: {
    metadata: Record<string, unknown>;
    patient_name?: string | null;
    patient_id?: string | null;
  };
}

export interface ResolvedSource {
  rawSource: RawSource;           // ready for pipeline
  transcriptText?: string;        // PHI-scrubbed, for persistence
  doctorNotes?: string;           // PHI-scrubbed, for persistence
  fileTexts: Array<{ id: string; name: string; type: string; text: string; context?: string }>;
  phiRedactionCount: number;
  refreshedMetadata: Record<string, unknown>;
}

export async function resolveSource(input: ResolveSourceInput): Promise<ResolvedSource>;
```

Absorbs: audio recovery (download + transcribe + concat), stuck extraction recovery, extraction polling, inline extraction fallback, PHI scrubbing, file-text assembly, transcript merge.

#### `web/src/lib/pipeline/session.ts`
Shared orchestration extracted from all three routes.

```ts
export interface PipelineSessionInput {
  supabase: SupabaseClient;
  userId: string;
  visitId: string;
  language: SupportedLanguage;
  rawSource: RawSource;
  fileIds: string[];
  visitMetadata: Record<string, unknown>;
  template: Template;
  sendEvent: (data: Record<string, unknown>) => void;
  // Adjust-specific (optional)
  leafIdFilter?: Set<string>;
  priorSectionContents?: Record<string, string>;
}

export interface PipelineSessionResult {
  generatedNote: string;
  sectionContents: Record<string, string>;
  templateId: string;
  clinicalAnalysis?: { suggestedIcdCodes: SuggestedIcdCode[] };
  updatedFileFocusCache?: FileFocusCache;
}

export async function runPipelineSession(input: PipelineSessionInput): Promise<PipelineSessionResult>;
```

Owns: file-focus filter (once) → skeleton ∥ ICD (parallel) → section loop (via `generateNote`) → Záver (format + critic + reconcilers) → HTML assembly. Calls `sendEvent` for streaming_start, section, complete events.

When `leafIdFilter` is set (adjust mode), only filtered sections render; Záver is conditional based on whether diagnosis-affecting sections are in the filter.

#### `web/src/lib/pipeline/persist.ts`
Shared persistence logic.

```ts
export interface PersistGenerationInput {
  supabase: SupabaseClient;
  visitId: string;
  generatedNote: string;
  templateId: string;
  sectionContents: Record<string, string>;
  metadataPartial?: Record<string, unknown>;
  updatedFileFocusCache?: FileFocusCache;
  status?: string;  // defaults to "to_review"
  label: string;
}

export async function persistGeneration(input: PersistGenerationInput): Promise<{ success: boolean; error?: unknown }>;
```

Absorbs: column update (encounter_note + status), metadata merge (template_id, section_contents, generation_pending: null, etc.), lost-note logging on failure.

#### `web/src/lib/pipeline/adjust-helpers.ts`
Adjust-specific utilities moved from adjust/route.ts.

Exports: `collectLeafSectionsForRouter()`, `isVitalOrExamLabel()`, `foldLabel()`, `VITAL_EXAM_LABELS`, `shouldRerunZaver()`.

#### `web/src/lib/pipeline/index.ts`
Barrel: re-exports `resolveSource`, `runPipelineSession`, `persistGeneration`.

### Client-side

#### `web/src/components/encounters/hooks/use-generation-stream.ts`
SSE streaming consumer extracted from god hook.

```ts
export interface UseGenerationStreamReturn {
  isStreaming: boolean;
  streamedSections: NoteSection[];
  streamingSectionIds: string[];
  streamingSectionLabels: Record<string, string>;
  executeStream: (params: {
    url: string;
    body: Record<string, unknown>;
    onComplete?: (event: Record<string, unknown>) => void;
  }) => Promise<Record<string, unknown> | null>;
  resetStream: () => void;
}

export function useGenerationStream(visitId: string): UseGenerationStreamReturn;
```

Absorbs: module-level `streamingCache` Map + localStorage persistence, `isTransientError`, `parseSSEStream` consumption, client-side retry loop (3 attempts), section accumulation, streaming state.

#### `web/src/components/encounters/hooks/use-pre-generation.ts`
Recording finalization + transcription extracted from god hook.

```ts
export interface PreGenerationResult {
  transcriptText: string | null;
  audioRecoveryPath: string | undefined;
  releaseGuards?: () => void;
}

export function usePreGeneration(visitId: string): {
  prepareSource: (params: {
    recordingBarRef: React.RefObject<RecordingBarRef | null>;
    language: SupportedLanguage;
    visit: Encounter | null;
  }) => Promise<PreGenerationResult>;
};
```

Absorbs: recording finalization (`recordingBarRef.current.finalize()`), blob upload to Supabase storage, transcription (transcribeFromPath with fallback to transcribeBlob), audio recovery path resolution, native foreground service teardown.

#### `web/src/components/encounters/hooks/use-doctor-notes.ts`
Doctor notes auto-save extracted from god hook.

```ts
export function useDoctorNotes(visitId: string): {
  doctorNotes: string;
  setDoctorNotes: (notes: string) => void;
  saveStatus: SaveStatusType;
  initFromVisit: (notes: string) => void;
};
```

Absorbs: 2-second debounced save, PATCH to `/api/encounters/:id`, save status tracking via `useSaveStatus`, blur-save, single retry after 3s.

---

## Modified Modules

### `web/src/app/api/generate/route.ts` — REWRITE (720 → ~120 lines)

Becomes a thin shell:
1. Auth (`requireAuth`)
2. Parse body: `{ visitId, templateId?, transcriptText?, audioPath?, doctorNotes?, sendAsEmail? }`
3. Fetch visit from DB
4. **If `transcriptText` or `audioPath` provided** → call `resolveSource()` (fresh mode)
5. **Otherwise** → build RawSource from cached metadata (replaces regenerate)
6. Resolve template
7. `createSSEStream` → `runPipelineSession()` → `persistGeneration()`
8. Post-generation: email dispatch + audio cleanup (generate-specific)
9. Return `sseResponse()`

No explicit `mode` field needed — the route auto-detects based on whether fresh source fields are present.

### `web/src/app/api/adjust/route.ts` — REWRITE (440 → ~100 lines)

Becomes a thin shell:
1. Auth
2. Parse body: `{ visitId, templateId?, adjustmentTranscript?, newFileIds? }`
3. Fetch visit, merge transcript delta into existing transcript
4. Build RawSource from cached metadata + merged transcript
5. Run router via `routeAdjustment()` + expand vital group via `adjust-helpers`
6. `createSSEStream` → `runPipelineSession(leafIdFilter, priorSectionContents)` → `persistGeneration()`
7. Return `sseResponse()`

### `web/src/components/encounters/hooks/use-encounter-generation.ts` — REWRITE (1,436 → ~400 lines)

Becomes a coordinator composing:
- `useGenerationStream` — SSE streaming
- `usePreGeneration` — recording finalization + transcription
- `useDoctorNotes` — auto-save
- `useTemplateCache` — unchanged
- `useGenerationPolling` — unchanged

Retains:
- `handleGenerate` — calls `prepareSource()` then `executeStream({ url: "/api/generate", ... })`
- `handleRegenerate` — checks template cache; on miss calls `executeStream({ url: "/api/generate", body: { visitId, templateId, doctorNotes } })` (no transcriptText = cached mode)
- `handleAdjustGenerate` — calls `prepareSource()` then `executeStream({ url: "/api/adjust", ... })`
- `initFromVisit`, auto-resume logic, template/language handlers

### `web/src/lib/sections/pipeline.ts` — NO CHANGES

`generateNote()`, `runCriticAndReconcilers()`, `findZaverSection()` stay exactly as-is. Called by `session.ts`.

### `web/src/app/[locale]/(app)/encounters/[visitId]/page.tsx` — MINIMAL CHANGES

The hook's return type is preserved. Only change: `useDoctorNotes` might be consumed directly for the doctor notes textarea if we want cleaner prop drilling. Otherwise transparent.

---

## Deleted Modules

- `web/src/app/api/regenerate/route.ts` — absorbed into `/api/generate`

---

## Test Plan

| Test file | What it covers | Key scenarios |
|---|---|---|
| `pipeline/resolve-source.test.ts` | Source resolver | Audio recovery + concat, stuck extraction reset, polling loop, inline extraction fallback, PHI scrub counts, metadata transcript fallback |
| `pipeline/session.test.ts` | Pipeline session | Full pipeline event sequence (streaming_start → sections → complete), Záver skip when not in template, adjust mode with leafIdFilter, file-focus cache propagation |
| `pipeline/persist.test.ts` | Persistence | Success path, column failure + LOST NOTE log, metadata merge failure, retry wrapper |
| `pipeline/adjust-helpers.test.ts` | Adjust utilities | `collectLeafSectionsForRouter` flattening, `foldLabel` diacritic stripping, `isVitalOrExamLabel` matching, `shouldRerunZaver` logic |
| `hooks/use-generation-stream.test.ts` | SSE consumer | Successful stream + section accumulation, client retry on 502, streaming cache persistence/restoration, reset |
| `hooks/use-pre-generation.test.ts` | Pre-generation | Blob finalize + upload + transcribe, upload failure fallback, restored session recovery path, no-blob metadata fallback |
| `hooks/use-doctor-notes.test.ts` | Doctor notes | Debounced save timing, no-op on unchanged, retry on failure, status transitions |

All server tests mock at module boundaries (Supabase client, `transcribeAudio`, `extractFileText`, `scrubPhi`, pipeline functions). Client tests mock `fetch` + `ReadableStream`.

---

## Implementation Phases

### Phase 1: Server-side extraction
- [ ] Create `web/src/lib/pipeline/` with `resolve-source.ts`, `session.ts`, `persist.ts`, `adjust-helpers.ts`, `index.ts`
- [ ] Write tests for all four modules
- [ ] Rewrite `generate/route.ts` to use the new modules
- [ ] Rewrite `adjust/route.ts` to use the new modules
- [ ] Verify regenerate/route.ts still works (not yet deleted)

### Phase 2: Client-side hook decomposition
- [ ] Create `use-doctor-notes.ts` + test
- [ ] Create `use-generation-stream.ts` + test
- [ ] Create `use-pre-generation.ts` + test
- [ ] Rewrite `use-encounter-generation.ts` to compose the three hooks
- [ ] Update `handleRegenerate` to call `/api/generate` instead of `/api/regenerate`

### Phase 3: Cleanup
- [ ] Delete `web/src/app/api/regenerate/route.ts`
- [ ] Run lint + prettier + build + tests
- [ ] Update KB docs (prompt-pipeline.md, documentation.md)

---

## Line Count Summary

| Module | Before | After | Delta |
|---|---|---|---|
| generate/route.ts | 720 | ~120 | -600 |
| regenerate/route.ts | 319 | 0 | -319 |
| adjust/route.ts | 440 | ~100 | -340 |
| use-encounter-generation.ts | 1,436 | ~400 | -1,036 |
| **New server modules** | 0 | ~570 | +570 |
| **New client hooks** | 0 | ~440 | +440 |
| **New test files (7)** | 0 | ~1,200 | +1,200 |
| **Net production** | **2,915** | **~1,630** | **-1,285** |

---

## Verification

1. `pnpm run lint` — no errors in web/
2. `npx prettier --write` on all changed files
3. `pnpm run build` — no type errors
4. `pnpm test` — all existing + new tests pass
5. Manual smoke test: create encounter → record → generate → review → adjust → template swap (regenerate via /api/generate)
6. `LIVE_LLM=1 pnpm run eval` — eval scores unchanged from baseline

---

## Phase 4: Architecture Audit Follow-up (Round 2)

Identified by `/improve-codebase-architecture` audit on 2026-04-28.

### Task 4.1: Extract file-state utilities from files-panel.tsx

**Problem**: `files-panel.tsx` mixes UI (React component) with pure business logic predicates and module-level state. Non-UI consumers (`use-encounter-generation.ts`, `adjust-drawer.tsx`, `page.tsx`) import logic from a `"use client"` UI file.

**Solution**: Create `web/src/lib/encounters/file-state.ts` with all non-UI exports.

**Moves to `lib/encounters/file-state.ts`**:
- `EncounterFile` interface
- `pendingContextSaves` Map + `awaitPendingContextSave()`
- `isFileUploading()`, `hasUploadingFiles()`
- `isFileExtracting()`, `hasExtractingFiles()`
- `awaitPendingExtractions()`

**Stays in `files-panel.tsx`**: `FilesContent`, `FilesPanel`, `iconForType()`

**Import updates**: 6 files change imports from `files-panel` to `@/lib/encounters/file-state` for non-UI exports.

**Tests**: Move `files-panel.test.ts` → `lib/encounters/file-state.test.ts`, add tests for `isFileExtracting`, `hasExtractingFiles`.

### Task 4.2: Verify adjust-helpers migration

**Status**: ✅ Already confirmed — `adjust-helpers.ts` lives at `lib/pipeline/adjust-helpers.ts` with tests. No stale imports from `sections/`.

### Task 4.3: Extract shared route boilerplate

**Problem**: generate and adjust routes repeat auth → visit fetch → SSE stream → pipeline run → persist → complete/error pattern.

**Solution**: Create `lib/pipeline/create-pipeline-handler.ts` with shared auth + SSE wrapper.

### Task 4.4: Write unit tests for generate and adjust API routes

**Approach**: Test routes as HTTP handler functions with mocked `requireAuth`, `supabase`, and pipeline modules.

**Coverage**: auth failure, missing visitId, visit not found, insufficient context, successful generation, pipeline errors.

---

## Phase 5: Architecture Deepening — Round 3

Identified by third `/improve-codebase-architecture` audit on 2026-04-28, after Phases 1–4 were complete (617 tests passing). A third audit surfaced 5 remaining friction points: magic-string custom events, duplicated PATCH calls, module-level generation state, untested hook orchestration, and 15 untested API routes.

### Dependency Graph

```
Task 5.1 (Event Bus) ──┬──> Task 5.2 (patchEncounter)
                       └──> Task 5.3 (GenerationTracker)
                                    │
                             Task 5.4 (Hook Tests)
                                    │
                             Task 5.5 (Route Tests)
```

---

### Task 5.1: Typed Event Bus

**New file:** `web/src/lib/events.ts`

- `CustomEventMap` interface — maps 6 event names to their typed payloads
- `emit<K>(name, payload)` — typed dispatch via `window.dispatchEvent(new CustomEvent(...))`
- `on<K>(name, handler)` — returns cleanup function for `useEffect`

**Events:**

| Name | Payload |
|------|---------|
| `encounter-update` | `{ id: string; status?: EncounterStatus; title?: string \| null }` |
| `encounter-delete` | `{ id: string }` |
| `sidebar-refresh` | `{ encounter: Encounter }` |
| `streaming-update` | `{ visitId: string; sections: NoteSection[]; sectionIds: string[]; sectionLabels: Record<string, string> }` |
| `generation-done` | `{ visitId: string }` |
| `extraction-complete` | `{ visitId: string; fileId: string }` |

**New test:** `web/src/lib/events.test.ts` (~3 tests)

**Migration:** 17 dispatch sites → `emit()`, 6 listener sites → `on()`

**Files modified (11):**
- `use-encounter-generation.ts` (7 dispatches)
- `use-generation-stream.ts` (2 dispatches)
- `use-generation-polling.ts` (2 dispatches + 1 listener)
- `use-encounter-data.ts` (2 listeners)
- `page.tsx` (2 dispatches + 1 listener)
- `files-panel.tsx` (1 dispatch)
- `use-create-encounter.ts` (1 dispatch)
- `use-sidebar-encounters.ts` (2 dispatches + 2 listeners)
- `use-sidebar-encounters.test.ts` (update test dispatches)

---

### Task 5.2: `patchEncounter` Helper

**New file:** `web/src/lib/encounters/api.ts`

Three variants covering all existing patterns:

```typescript
// Fire-and-forget, returns Response | null
patchEncounter(visitId, patch: UpdateEncounterRequest): Promise<Response | null>

// PATCH + emit("encounter-update") in one call
patchEncounterStatus(visitId, status, extraPatch?): Promise<Response | null>

// Throws on failure (for callers needing error propagation)
patchEncounterOrThrow(visitId, patch): Promise<Response>
```

`UpdateEncounterRequest` already exists in `web/src/lib/types.ts:56`.

**New test:** `web/src/lib/encounters/api.test.ts` (~6 tests)

**Migration (~25 sites):**
- `patchEncounter()` — 19 fire-and-forget sites across `use-encounter-generation.ts` (10), `use-encounter-data.ts` (4), `use-section-editing.ts` (1), `icd-panel.tsx` (1), `recording-bar.tsx` (2), `use-encounter-metadata.ts` (2, check response before setState)
- `patchEncounterStatus()` — 4 sites: `use-encounter-generation.ts:100-109` (recording state), `use-generation-polling.ts:113-122`, `page.tsx:224-235`, `use-sidebar-encounters.ts:186-197`
- `patchEncounterOrThrow()` — 1 site: `use-recording-consent.ts:35-48`

**DO NOT replace (custom logic):**
- `use-doctor-notes.ts` — has retry logic with 3s delay
- `files-panel.tsx handleContextSave` — fetch-then-merge pattern

---

### Task 5.3: `GenerationTracker` Class

**New file:** `web/src/lib/encounters/generation-tracker.ts`

```typescript
class GenerationTracker {
  isActive(visitId): boolean
  start(visitId): boolean           // false if already active
  complete(visitId): void           // clears active + cache, emits generation-done
  getCache(visitId): StreamingCacheEntry | null  // memory → localStorage fallback
  updateCache(visitId, update): void             // memory + localStorage + emit streaming-update
  clearCache(visitId): void
}

export const generationTracker = new GenerationTracker();
```

Moves `StreamingCacheEntry` interface here. Uses `emit()` from Task 1 internally.

**New test:** `web/src/lib/encounters/generation-tracker.test.ts` (~8 tests, fresh instance per test)

**Refactor `use-generation-stream.ts`:**
- Remove ~80 lines of module-level state + helper functions
- Import `generationTracker` singleton
- `isGenerationActive()` export delegates to `generationTracker.isActive()`
- `executeStream` uses `tracker.start()` / `tracker.complete()` / `tracker.updateCache()`
- `restoreFromCache` uses `tracker.getCache()`

---

### Task 5.4: `use-encounter-generation` Tests

**New file:** `web/src/components/encounters/hooks/use-encounter-generation.test.ts`

Mock at hook boundaries: `useGenerationStream`, `usePreGeneration`, `useDoctorNotes`, `useTemplateCache`, `useGenerationPolling`, `useGenerationTimer`. Mock `patchEncounter`/`patchEncounterStatus` from Task 2.

**Test groups (~15-20 tests):**
- `handleGenerate`: prepareSource → processing → executeStream → to_review, auto-title, insufficient_context error, save_failed error
- `handleAdjustGenerate`: adjust endpoint, merged notes, cache cleared
- `handleRegenerate`: cache hit (instant), cache miss (stream), error revert, no-op on same template
- `initFromVisit` / auto-resume: processing state restore, interrupted generation detection, reset when no content
- `handleRecordingStateChange`: status toggle, skip when generation active

---

### Task 5.5: Remaining Route Tests (15 routes)

**New shared util:** `web/src/test/route-helpers.ts` — `createMockSupabase()`, `makeJsonRequest()`

**Critical (3 routes, ~35 tests):**
1. `PATCH /api/encounters/[encounterId]` — column updates, metadata merge RPC, validation
2. `POST /api/batch-transcribe` — storage path mode, direct blob mode, retry, ElevenLabs mock
3. `POST /api/encounters/[encounterId]/extract` — OCR flow, retry, failed states, LOST TEXT logging

**High (3 routes, ~25 tests):**
4. `DELETE /api/encounters/[encounterId]` — soft/hard delete, storage cleanup
5. `POST /api/encounters/[encounterId]/files` — JSON + FormData modes, path validation
6. `POST /api/send-note-email` — email dispatch, missing note guard

**Medium (4 routes, ~25 tests):**
7-8. `GET/POST /api/encounters` — pagination, filters, create
9-10. `GET /api/encounters/[encounterId]`, `GET .../files` — fetch + file listing

**Low (5 routes, ~15 tests):**
11-15. Templates CRUD, ICD/medication search, admin routes

**Estimated**: ~100 new tests across ~8 test files.

---

### Phase 5 Verification

After each task:
1. `cd web && npx vitest run` — all tests pass
2. `npm run lint` — no errors (no eslint-disable)
3. `npm run build` — no type errors

After all 5 tasks:
- Total test count should increase from 617 to ~720+
- `use-encounter-generation.ts` PATCH calls reduced from 12 raw fetches to 12 `patchEncounter()`/`patchEncounterStatus()` calls
- `use-generation-stream.ts` shrinks by ~80 lines
- All 17 event dispatch sites use typed `emit()`, all 6 listener sites use typed `on()`
- 15 previously untested routes have coverage
