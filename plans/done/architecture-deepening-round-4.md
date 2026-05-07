# Architecture Deepening — Round 4

## Context

Audit from 2026-05-06 identified 11 friction points across two passes: 5 from the current `/improve-codebase-architecture` audit and 6 from a previous candidate list. All validated against current code.

**Prioritization:** grouped into 3 tiers — Quick Cleanups (immediate, no risk), Module Extractions (medium effort, high locality gains), and Architectural Deepening (larger refactors, high leverage).

---

## Tier 0: Quick Cleanups (30 min total)

### 0.1: Delete orphan `useAudioRecorder.ts`

**File:** `web/src/hooks/useAudioRecorder.ts` (128 lines, zero imports)

- [ ] Delete `web/src/hooks/useAudioRecorder.ts`
- [ ] Verify no imports reference it: `grep -r "useAudioRecorder" web/src/`

### 0.2: Remove dead re-export from recording-bar.tsx

**File:** `web/src/components/encounters/recording-bar.tsx` line 99

```typescript
// DELETE THIS LINE:
export { audioMimeToExt } from "@/components/encounters/hooks/use-audio-recorder";
```

Nobody imports `audioMimeToExt` from `recording-bar.tsx`. The two consumers import directly from `use-audio-recorder.ts`.

- [ ] Remove line 99 from `recording-bar.tsx`
- [ ] Run `npx vitest run` + lint

### 0.3: Remove dead setter props from `use-generation-polling`

**File:** `web/src/components/encounters/hooks/use-generation-polling.ts`

`setIsGenerating` and `setIsStreaming` are passed as `() => {}` from the call site in `use-encounter-generation.ts`. The polling hook calls them but they do nothing.

- [ ] Remove `setIsGenerating` and `setIsStreaming` from the polling hook's interface
- [ ] Remove the no-op arguments from the call site
- [ ] Run tests

---

## Tier 1: Module Extractions (targeted, low-risk)

### 1.1: Unify transient-error classification (3 copies → 1)

**Problem:** Three separate implementations of "is this error worth retrying?" with different patterns:

| File | Function | Patterns |
|------|----------|----------|
| `web/src/lib/supabase/retry.ts:82` | `isTransientFetchError()` | fetch failed, econnreset, socket hang up, und_err_socket, etc. |
| `web/src/lib/transcription/transcribe-blob.ts:28-39` | inline check | Status 429/500/502/503/504, "overloaded", "rate limit" |
| `web/src/components/encounters/hooks/use-generation-stream.ts:23-32` | `isTransientError()` | Status 502/503, "fetch failed", "network" |

**Solution:** Create `web/src/lib/api/is-transient-error.ts` with the superset.

```typescript
export function isTransientNetworkError(err: unknown): boolean { ... }
export function isTransientStatusCode(status: number): boolean { ... }
```

- [ ] Create `web/src/lib/api/is-transient-error.ts`
- [ ] Write `web/src/lib/api/is-transient-error.test.ts` (~10 tests)
- [ ] Replace all 3 call sites
- [ ] Run tests

### 1.2: Unify MIME-to-extension mapping (2 active copies → 1)

**Problem:** `audioMimeToExt()` in `use-audio-recorder.ts` (exported) and `blobMimeToExt()` in `transcribe-blob.ts` (private copy) do the same thing.

**Solution:** Extract to `web/src/lib/audio/mime-utils.ts`.

- [ ] Create `web/src/lib/audio/mime-utils.ts` with `audioMimeToExt()`
- [ ] Update `use-audio-recorder.ts` to import from `@/lib/audio/mime-utils`
- [ ] Update `transcribe-blob.ts` to import from `@/lib/audio/mime-utils`, delete private `blobMimeToExt`
- [ ] Run tests

### 1.3: Extract `useFileUpload` from `files-panel.tsx`

**File:** `web/src/components/encounters/files-panel.tsx` (503 lines)

**Problem:** `uploadFiles` is a 177-line function (lines 61-238) inside a React component that orchestrates upload → metadata registration → extraction trigger → retry → state updates → event emission. `handleContextSave` does a manual fetch-then-merge read-modify-write. Both are untestable without rendering the component.

**Solution:** Extract `useFileUpload(visitId)` hook.

```typescript
// web/src/components/encounters/hooks/use-file-upload.ts
export function useFileUpload(visitId: string): {
  uploadFiles: (files: File[]) => Promise<void>;
  isUploading: boolean;
  extractionStatus: Map<string, ExtractionStatus>;
};
```

- [ ] Create `use-file-upload.ts` hook
- [ ] Write `use-file-upload.test.ts` (~8 tests: upload success, upload failure, extraction polling, retry, concurrent uploads)
- [ ] Refactor `files-panel.tsx` to use the hook (should drop to ~300 lines)
- [ ] Replace `handleContextSave`'s read-modify-write with `mergeVisitMetadata` RPC
- [ ] Run tests

### 1.4: Extract `persistRecordingSnapshot` from `recording-bar.tsx`

**File:** `web/src/components/encounters/recording-bar.tsx` (~600 lines)

**Problem:** `persistBlobAtPause` (lines 236-317, 82 lines) is business logic (upload → metadata PATCH → transcribe → PATCH transcript) trapped inside a forwardRef component closure. It captures 9+ values from closure. Zero tests on this component.

**Solution:** Extract as a pure async function.

```typescript
// web/src/lib/encounters/persist-recording-snapshot.ts
export async function persistRecordingSnapshot(params: {
  blob: Blob;
  visitId: string;
  language: SupportedLanguage;
  durationSeconds: number;
  isNative: boolean;
  existingPath?: string;
}): Promise<{ storagePath: string; transcript: string }>;
```

- [ ] Create `persist-recording-snapshot.ts`
- [ ] Write `persist-recording-snapshot.test.ts` (~6 tests: upload, transcribe, native vs web paths, failure rollback)
- [ ] Refactor `recording-bar.tsx` to call the extracted function
- [ ] Run tests

---

## Tier 2: Architectural Deepening (higher effort, high leverage)

### 2.1: Fix auth, audit, and usage tracking in adjust-section

**Files:**
- `web/src/app/api/adjust-section/route.ts` (263 lines)

**Problem:** The adjust-section route has real bugs: it uses manual `createClient()` instead of `requireAuth()`, has no audit trail (`logAudit()`), and no `api_usage` tracking. These are correctness issues, not architectural ones.

**Why not route through the pipeline:** The adjust-section route has a fundamentally different job than the generation pipeline. The pipeline generates from raw sources (transcript, files, context). Adjust-section applies a surgical doctor correction to existing content using the doctor's explicit feedback. Running doctor corrections through the critic/reconcilers would second-guess the doctor's intent — the opposite of what we want. Two separate LLM paths is the correct architecture here.

**Solution (Option A — locked in):**
- Replace `createClient()` with `requireAuth()`
- Add `logAudit()` call after successful regeneration
- Add `api_usage` tracking (token counts, cost, model)

- [ ] Replace `createClient` with `requireAuth` in adjust-section route
- [ ] Add `logAudit()` call
- [ ] Add `api_usage` tracking
- [ ] Write `adjust-section/route.test.ts` (~8 tests)
- [ ] Run tests

### 2.2: Extract shared generation executor from god hook

**File:** `web/src/components/encounters/hooks/use-encounter-generation.ts` (682 lines)

**Problem:** `handleGenerate` (lines 109-248, 139 lines) and `handleAdjustGenerate` (lines 252-368, 116 lines) follow the same pattern: finalize recording → switch to processing → persist intent → release guards → await saves → execute stream → handle completion → handle errors. ~60-70% of logic is identical. The differences are URL, body construction, and error recovery status.

**Solution:** Extract a shared internal helper:

```typescript
async function executeGenerationFlow(params: {
  url: string;
  buildBody: () => Record<string, unknown>;
  errorRecoveryStatus: EncounterStatus;
  onComplete?: (event: Record<string, unknown>) => void;
}): Promise<void>;
```

Both `handleGenerate` and `handleAdjustGenerate` become thin callers that assemble their specific body and callbacks.

- [ ] Extract `executeGenerationFlow` internal helper
- [ ] Simplify both handler functions
- [ ] Run tests (existing `use-encounter-generation.test.ts`)
- [ ] Verify smoke test: generate + adjust flows

### 2.3: Merge feedback hooks

**Files:**
- `web/src/components/encounters/hooks/use-feedback.ts` (161 lines)
- `web/src/components/encounters/hooks/use-feedback-regeneration.ts` (157 lines)

**Problem:** These two hooks manage the same concern (doctor feedback on sections) but split across files. `use-feedback-regeneration.ts` orchestrates two sequential API calls (submit → regen) with its own parent/child section detection logic. The page wires them together, passing refs between them.

**Solution:** Merge into a single `use-section-feedback` hook:

```typescript
export function useSectionFeedback(params: {
  visitId: string | undefined;
  sectionContentsRef: React.RefObject<Record<string, string>>;
  replaceSections: (updates: Record<string, string>) => void;
  template: Template | null | undefined;
  sectionLabels: Record<string, string>;
}): {
  getRating: (sectionId: string | null) => "up" | "down" | null;
  submitUp: (sectionId: string | null) => Promise<void>;
  submitDown: (sectionId: string | null, options: SubmitDownOptions) => Promise<void>;
  removeFeedback: (sectionId: string | null) => Promise<void>;
  handleSectionSubmitFeedback: (sectionId: string, detail: string, remember: boolean) => Promise<void>;
  regeneratingSectionId: string | null;
  isLoaded: boolean;
};
```

- [ ] Create `use-section-feedback.ts` merging both hooks
- [ ] Update page.tsx to use the merged hook
- [ ] Delete `use-feedback.ts` and `use-feedback-regeneration.ts`
- [ ] Update tests
- [ ] Run tests

---

## Dependency Graph

```
Tier 0 (Quick Cleanups) — no dependencies, do first
    │
    v
Tier 1.1 (isTransientError) ──> Tier 2.2 (generation executor)
Tier 1.2 (MIME utils) ─────────────────────────────────────── standalone
Tier 1.3 (useFileUpload) ──────────────────────────────────── standalone
Tier 1.4 (persistRecordingSnapshot) ───────────────────────── standalone
    │
    v
Tier 2.1 (adjust-section auth fix) ─────────────────────────── standalone
Tier 2.2 (generation executor) ────────────────────────────── standalone
```

---

## Implementation Order

### Phase A: Quick Cleanups (Tier 0)
- 0.1 → 0.2 → 0.3
- Commit after all three

### Phase B: Utility Extractions (Tier 1.1 + 1.2)
- 1.1 (isTransientError) then 1.2 (MIME utils)
- Commit after each

### Phase C: Hook Extractions (Tier 1.3 + 1.4)
- 1.3 (useFileUpload) and 1.4 (persistRecordingSnapshot) — independent, can be parallel
- Commit after each

### Phase D: Architectural Deepening (Tier 2)
- 2.1 (adjust-section auth fix) — standalone, no response shape changes
- 2.2 (generation executor) — standalone
- 2.3 (merge feedback hooks) — standalone (no dependency on 2.1 since Option A preserves response shape)

### Phase E: Verification
- [ ] `npx vitest run` — all tests pass
- [ ] `npm run lint` — no errors
- [ ] `npm run build` — no type errors
- [ ] Update KB docs (documentation.md, prompt-pipeline.md) if Tier 2 changes pipeline

---

## Estimated Line Impact

| Change | Lines removed | Lines added | Net |
|--------|-------------|-------------|-----|
| **Tier 0** (cleanups) | ~135 | 0 | -135 |
| **Tier 1.1** (isTransientError) | ~45 | ~60 (+tests) | +15 |
| **Tier 1.2** (MIME utils) | ~20 | ~30 (+tests) | +10 |
| **Tier 1.3** (useFileUpload) | ~180 (from panel) | ~250 (+hook +tests) | +70 |
| **Tier 1.4** (persistRecording) | ~80 (from bar) | ~150 (+fn +tests) | +70 |
| **Tier 2.1** (adjust-section auth fix) | ~10 | ~80 (+auth +audit +usage +tests) | +70 |
| **Tier 2.2** (generation executor) | ~100 (dedup) | ~40 (helper) | -60 |
| **Tier 2.3** (merge feedback) | ~318 (two hooks) | ~220 (one hook) | -98 |
| **Total** | **~1,078** | **~810** | **-268 prod, +~300 tests** |
