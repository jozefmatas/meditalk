Generation Pipeline Refactor Plan

## Progress Tracker

✅ **Phase 1: Remove recording.webm Upload** - COMPLETED

- Removed upload logic from `use-encounter-generation.ts`
- Removed `handleRecordingStart()` and `pendingRecordingFileRef` tracking
- Simplified `handleRecordingComplete()` to keep blob in memory only
- Removed recording skip logic from generate route
- Transcript now passed directly from Scribe WebSocket to API

✅ **Bug Fix: Metadata Race Condition** - COMPLETED (v3: Fully Resolved)

- Issue: Concurrent extractions overwriting each other's JSONB metadata updates
- Solution v1 (failed): Retry logic with dual verification - still had race conditions
- Solution v2 (failed): Atomic RPC + generate route still writing metadata
- Solution v3 (final): PostgreSQL atomic update function + removed generate route writes
  - Created `update_file_extraction_status()` RPC function
  - Uses PostgreSQL JSONB operators to update specific file's status atomically
  - Removed metadata.files write from generate route (was overwriting atomic updates)
  - Added error handling to mark files as "failed" instead of stuck "extracting"
  - No more read-modify-write pattern - eliminates race condition entirely
  - Migration: `20260401120753_atomic_file_status_update.sql`
- Result: All files show correct "completed" status, no race conditions

✅ **Bug Fix: WebSocket Error 1006** - COMPLETED

- Issue: Abrupt WebSocket closure when generating while recording
- Root cause: VAD needs time to commit final chunks before connection closes
- Solution: 200ms grace period in `finalize()` before calling `stopScribe()`
- Result: Clean WebSocket shutdown, no more error 1006

✅ **Phase 3: Consolidate Extraction Logic** - COMPLETED

- Created shared `extractFileText()` service in `web/src/lib/extraction/extract-file.ts`
- Extract route now uses shared service for all file types
- Generate route now uses shared service for ALL file types (images, PDFs, audio)
- Removed ~280 lines of duplicate extraction code

✅ **Phase 7: Remove Audio Anonymization** - COMPLETED (merged into Phase 3)

- Removed audio anonymization logic (~280 lines) from generate route
- Simplified audio extraction to use shared service
- Removed dependencies on audio-anonymization library
- All audio files now transcribed directly (no anonymization overhead)

✅ **Phase 2: Split RecordingBar** - COMPLETED

- Split 1,040-line `recording-bar.tsx` into 4 focused hooks + orchestrator
- `recording-bar.tsx` (412 lines) — UI orchestration + action wiring
- `hooks/use-audio-recorder.ts` (322 lines) — MediaRecorder lifecycle, segments, IndexedDB persistence, timer
- `hooks/use-scribe-streaming.ts` (178 lines) — Scribe WebSocket, PCM piping, transcript accumulation
- `hooks/use-recording-guards.ts` (182 lines) — Navigation guard, wake lock, notifications
- `hooks/use-audio-devices.ts` (50 lines) — Device enumeration/selection
- Key design: Ref pattern for cleanup useEffect + useImperativeHandle; no manual useCallback (React Compiler)
- Bug fix: Replaced ScriptProcessorNode with AudioWorklet (`public/scribe-processor.js`) — fixes queue_overflow error (main-thread jank caused burst sends)
- Bug fix: Always downsample to 16 kHz (was sending 48 kHz = 3x too much data)
- Bug fix: Proper 1006 error suppression (JSON.stringify instead of String on error objects)
- Bug fix: Close AudioContext before Scribe connection (stops audio pipeline first)
- Bug fix: API 422 now returns `"insufficient_context"` so client resets to draft view instead of stuck ProcessingOverlay

⏳ **Phase 4: Split ReviewView** - PENDING

✅ **Phase 5: Simplify File Metadata** - COMPLETED

⏳ **Phase 6: Consolidate Email Logic** - PENDING

---

## Context

The generation pipeline has evolved organically and now contains:

- Duplicate extraction logic across multiple routes
- Oversized components (1,000+ lines) with multiple responsibilities
- ~~Unnecessary recording.webm upload (we have real-time transcript)~~ ✅ FIXED
- Complex extraction status polling that can be simplified
- Scattered file handling logic that's hard to debug

This refactor will:

1. ~~Remove recording.webm upload entirely (use real-time transcript only)~~ ✅ DONE
2. Split large components into focused, testable pieces
3. Consolidate duplicate extraction logic
4. Simplify file metadata management
5. Improve debuggability with smaller, single-responsibility modules

---

## Phase 1: Remove recording.webm Upload ✅ COMPLETED

### Why

We already have real-time transcript from Scribe WebSocket during recording. Uploading the audio file as `recording.webm` with `source: "recording"` and `status: "pending"` creates unnecessary complexity:

- File sits pending forever (frontend doesn't extract it)
- Generate route must skip it specially when transcript is present
- Wastes storage space
- Adds latency (upload + wait for non-existent extraction)

### What Was Done

**1. Frontend: Removed blob upload after recording**

- File: `web/src/components/encounters/hooks/use-encounter-generation.ts`
- ✅ Removed `uploadWithPersistence()` call and upload logic
- ✅ Removed `handleRecordingStart()` function that added pending file to UI
- ✅ Removed `pendingRecordingFileRef` state management
- ✅ Removed `audioStoragePathRef`, `uploadToStorage()`, `mimeToExt()` helpers
- ✅ Simplified `handleRecordingComplete()` to only keep blob in memory for `canGenerate` check
- ✅ Transcript passed directly to `/api/generate` from streaming state

**2. Frontend: Removed pending recording file from UI**

- File: `web/src/components/encounters/recording-bar.tsx`
- ✅ Removed `onRecordingStart` prop
- ✅ Removed `pendingRecordingIdRef` tracking
- ✅ Made `finalize()` async with 200ms grace period for VAD
- Files: `draft-view.tsx`, `adjust-drawer.tsx`
- ✅ Removed `onRecordingStart` prop from interfaces and usage

**3. Backend: Simplified generate route waiting logic**

- File: `web/src/app/api/generate/route.ts`
- ✅ Removed recording source skip logic (no longer needed)
- ✅ Simplified to just wait for actual uploaded files (images, PDFs)
- ✅ Kept debug logging for extraction status changes

**4. IndexedDB segment storage**

- File: `web/src/components/encounters/recording-bar.tsx`
- ✅ Decision: Kept IndexedDB persistence (useful for crash recovery during recording)

### Testing Results

✅ Record with transcript → generate → no recording.webm in storage
✅ Upload image + record → generate → image extracted, recording not uploaded
✅ Both transcript and uploaded files work together correctly
✅ No regressions in user flows

### Bug Fixes During Phase 1

**Bug #1: Metadata Race Condition**

- **Issue**: Concurrent file extractions overwriting each other's JSONB metadata updates
- **Symptom**: Extract route saves "completed", generate route sees "pending"
- **Root cause**: Multiple extract routes read-modify-write same JSONB metadata
- **Solution**: Added retry logic with dual verification in `extract/route.ts`
  - Snapshot completed files before write
  - Verify our update persisted AND we didn't overwrite others
  - 5 retries with 100ms delay
- **Result**: All files show correct "completed" status after extraction

**Bug #2: WebSocket Error 1006**

- **Issue**: WebSocket closed unexpectedly when generating while recording
- **Symptom**: `[browser] WebSocket closed unexpectedly: 1006 - No reason provided`
- **Root cause**: `finalize()` immediately closed Scribe WebSocket without letting VAD commit final chunks
- **Solution**: Added 200ms grace period before `stopScribe()` when recording is active
- **Result**: Clean WebSocket shutdown, no more error 1006

### Code Quality

✅ Lint passed: `npm run lint`
✅ Build passed: `npm run build`
✅ All critical bugs fixed
✅ Production-ready code with good logging

## Phase 2: Split RecordingBar Component ✅ COMPLETED

### What Was Done

Split 1,040-line monolith into focused modules:

```
recording-bar.tsx (412 lines) — UI orchestration + action wiring
hooks/
├── use-audio-recorder.ts (322 lines) — MediaRecorder lifecycle, segments, IndexedDB, timer
├── use-scribe-streaming.ts (178 lines) — Scribe WebSocket, AudioWorklet PCM, transcript
├── use-recording-guards.ts (182 lines) — Navigation guard, wake lock, notifications
└── use-audio-devices.ts  (50 lines)  — Device enumeration/selection
public/
└── scribe-processor.js              — AudioWorklet processor (static file for CSP)
```

### Design Decisions

- **Ref pattern**: Cleanup `useEffect` + `useImperativeHandle` avoids re-running on every state/duration change while keeping latest values accessible
- **No manual `useCallback`** on action handlers — React Compiler handles memoization
- **`audioMimeToExt`** re-exported from `recording-bar.tsx` for backward compatibility

### Bug Fixes During Phase 2

**Bug #3: Scribe queue_overflow**

- **Issue**: `queue_overflow` error — audio sent too frequently
- **Root causes**: (1) ScriptProcessorNode runs on main thread, React renders cause callbacks to pile up and burst-fire; (2) sending 48 kHz PCM when Scribe only needs 16 kHz (3x too much data)
- **Solution**: Replaced ScriptProcessorNode with AudioWorklet (`public/scribe-processor.js`) running on dedicated audio thread. Always downsamples to 16 kHz with 250ms chunking (4 sends/sec, ~43 KB/s vs previous ~130 KB/s with bursts)
- **CSP fix**: Blob URL blocked by CSP `script-src` policy, so worklet served as static file from `/public`

**Bug #4: WebSocket 1006 cosmetic error on pause/generate**

- **Issue**: `WebSocket closed unexpectedly: 1006 - No reason provided` logged to console
- **Root cause**: Error handler used `String(err)` which returns `[object Object]` on the error object, so the 1006 check never matched
- **Solution**: Use `JSON.stringify(err)` to properly serialize; also reversed close order (AudioContext first → stops audio pipeline, then Scribe connection)

**Bug #5: ProcessingOverlay stuck on insufficient context**

- **Issue**: Generating with no transcript/files returned 422 with long error message that didn't match client's `"insufficient_context"` check → status stuck on "processing" → ProcessingOverlay forever
- **Solution**: API now returns `{ error: "insufficient_context" }` → client resets to "started" → DraftView with ErrorAlert
  Phase 3: Consolidate Extraction Logic
  Why
  File extraction logic is duplicated in two places:

/api/generate/route.ts (lines 263-642) - extracts on-demand during generation
/api/encounters/[encounterId]/extract/route.ts (lines 148-223) - background extraction
Both implement identical logic for:

Image OCR (download → EXIF rotate → Claude Vision)
PDF extraction (signed URL → Claude)
Audio transcription (ElevenLabs Scribe v2)
Issues:

Bug fixes must be applied twice
Inconsistent error handling
Different timeout behaviors
Hard to maintain
Solution: Extract to Shared Service
New file: web/src/lib/extraction/extract-file.ts

export async function extractFileText(params: {
file: { type: string; path: string; name: string };
supabase: SupabaseClient;
userId: string;
}): Promise<{ text: string; elapsedMs: number }> {
// Single implementation of extraction logic
// Used by both /api/generate and /api/extract routes
}
Files to Modify
web/src/app/api/generate/route.ts - replace extraction logic with extractFileText()
web/src/app/api/encounters/[encounterId]/extract/route.ts - replace extraction logic with extractFileText()
Create: web/src/lib/extraction/extract-file.ts
Benefits
Single source of truth for extraction
Consistent error handling
Easier to add new file types (e.g., Word docs)
Testable in isolation
Phase 4: Split ReviewView Component
Why
ReviewView is 1,054 lines with multiple responsibilities:

Streaming note rendering (skeleton → content)
Section editing (add/remove/update)
Mobile header collapse on scroll
Resources panel (transcript, notes, files)
Copy/email actions
ICD code panel integration
Adjust drawer coordination
New Structure

review-view.tsx (400 lines)
├── Main layout + tabs
├── Copy/email actions
├── ICD panel integration
└── Calls components below

components/
├── streaming-note-content.tsx (300 lines)
│ ├── Section rendering with streaming states
│ ├── Skeleton placeholders
│ ├── Section editing controls
│ └── Props: sections, isStreaming, onSectionChange
│
├── resources-panel.tsx (already exists, 100 lines)
│ ├── Accordion with transcript/notes/files
│ └── Already well-factored
│
└── adjust-drawer.tsx (already exists)
└── Recording + files + notes for adjustment

hooks/
└── use-mobile-header-collapse.ts (80 lines)
├── Scroll position tracking
├── Collapse/expand logic
└── Returns: { isCollapsed, headerRef }
Files to Create
web/src/components/encounters/streaming-note-content.tsx
web/src/components/encounters/hooks/use-mobile-header-collapse.ts
Files to Modify
web/src/components/encounters/review-view.tsx (reduce from 1,054 → ~400 lines)
Phase 5: Simplify File Metadata ✅ COMPLETED

### Context

File metadata (stored in `visits.metadata.files[]` JSONB) has 4 different inline type definitions across the codebase, inconsistent extraction status values (`"pending"` used but missing from types), verbose polling logic in the generate route (~100 lines), and no timestamps for debugging extraction performance. The atomic RPC (`update_file_extraction_status`) already solved race conditions — this phase cleans up the remaining type/code debt.

### Changes

#### 1. Shared types in `web/src/lib/types.ts`

Add `ExtractionStatus` union and `FileMetadata` interface — single source of truth replacing 4 inline definitions.

```typescript
export type ExtractionStatus =
  | "pending"
  | "extracting"
  | "completed"
  | "failed";

export interface FileMetadata {
  id: string;
  name: string;
  size: number;
  type: string;
  path?: string; // optional: client pending files don't have path yet
  source?: string;
  extracted_text?: string | null;
  extraction_status?: ExtractionStatus | null;
  extracted_at?: string | null; // ISO timestamp, set by RPC on completion/failure
}
```

#### 2. Update `EncounterFile` to extend `FileMetadata`

**File:** `web/src/components/encounters/files-panel.tsx`

```typescript
import type { FileMetadata } from "@/lib/types";

export interface EncounterFile extends FileMetadata {
  pending?: boolean;
  isRecording?: boolean;
}
```

Removes duplicate field definitions, adds missing `"pending"` status to the type.

#### 3. Replace local `FileMetadata` in `web/src/lib/time-estimation.ts`

Import from `@/lib/types` instead of the local 6-line interface.

#### 4. Import `FileMetadata` in API routes

- **`web/src/app/api/generate/route.ts`** — replace inline type at lines 97-110
- **`web/src/app/api/encounters/[encounterId]/extract/route.ts`** — replace inline type at lines 60-68

#### 5. Add `extracted_at` timestamp via new migration

**File:** `web/supabase/migrations/20260401130000_add_extracted_at_to_rpc.sql`

Update the `update_file_extraction_status` RPC to set `extracted_at` when status is `'completed'` or `'failed'`:

```sql
IF p_status IN ('completed', 'failed') THEN
  v_updated_files := jsonb_set(
    v_updated_files,
    ARRAY[v_file_index::text, 'extracted_at'],
    to_jsonb(now()::text)
  );
END IF;
```

No code changes needed — existing RPC calls automatically get timestamps.

#### 6. Simplify generate route polling (~100 → ~30 lines)

**File:** `web/src/app/api/generate/route.ts` lines 112-209

Replace the verbose polling loop (per-iteration status change logging, Set tracking, post-loop summaries, debug blocks) with a simple poll-until-resolved loop. Same behavior: 500ms interval, 60s timeout, breaks early.

#### 7. Clean up generate route unprocessed-file logging

**File:** `web/src/app/api/generate/route.ts` lines 222-245

Replace the `statusSummary` mapping + `undefinedStatus` warning with a single concise log line distinguishing failed vs legacy (no status) files.

#### 8. Consolidate extract route success logs

**File:** `web/src/app/api/encounters/[encounterId]/extract/route.ts`

3 duplicate success log lines → 1 concise log.

### Files to Modify

| File                                                                 | Change                                  |
| -------------------------------------------------------------------- | --------------------------------------- |
| `web/src/lib/types.ts`                                               | Add `ExtractionStatus` + `FileMetadata` |
| `web/src/components/encounters/files-panel.tsx`                      | `EncounterFile extends FileMetadata`    |
| `web/src/lib/time-estimation.ts`                                     | Import shared `FileMetadata`            |
| `web/src/app/api/generate/route.ts`                                  | Import type, simplify polling + logging |
| `web/src/app/api/encounters/[encounterId]/extract/route.ts`          | Import type, consolidate logs           |
| `web/supabase/migrations/20260401130000_add_extracted_at_to_rpc.sql` | New: updated RPC with `extracted_at`    |

### Verification

1. `npm run lint` — no type errors from the shared type changes
2. `npm run build` — compilation passes
3. Manual: upload an image → check extraction completes → `extracted_at` is set in DB metadata
4. Manual: generate with pending extraction → polling resolves correctly
5. Manual: generate with no content → `insufficient_context` error, returns to draft view
   Phase 6: Consolidate Email Logic
   Why
   Email sending logic is duplicated:

/api/generate/route.ts (lines 923-932) - send after generation
/api/send-note-email/route.ts - manual send later
Both filter empty sections, generate magic links, call sendNoteEmail().

Solution
Move shared logic to web/src/lib/email/send-note.ts:

export async function sendEncounterNoteEmail(params: {
visitId: string;
userId: string;
supabase: SupabaseClient;
}): Promise<void> {
// Single implementation
// Used by both routes
}
Files to Modify
Create: web/src/lib/email/send-note.ts
Modify: /api/generate/route.ts - use shared function
Modify: /api/send-note-email/route.ts - use shared function
Phase 7: Optional - Remove Anonymization Feature
Why
Audio anonymization is:

Disabled by default (ENABLE_AUDIO_ANONYMIZATION=false)
Adds 200+ lines of complexity in /api/generate
Fallback for when transcription fails (rarely happens)
Never used in production
Decision Needed
Ask user: Should we remove audio anonymization entirely, or keep it dormant?

If remove:

Delete anonymization logic from /api/generate (lines 358-562)
Remove anonymizeAudioWithWhisper() function
Simplify audio handling path
If keep:

Leave as-is (dormant feature)
Document that it's disabled by default
Implementation Order
Phase 1 (Remove recording.webm upload) - Immediate win, reduces complexity
Phase 3 (Consolidate extraction) - Foundation for other changes
Phase 2 (Split RecordingBar) - Improves frontend debuggability
Phase 4 (Split ReviewView) - Improves frontend debuggability
Phase 5 (Simplify file metadata) - Performance optimization
Phase 6 (Consolidate email) - Code cleanup
Phase 7 (Remove anonymization) - Optional cleanup
Critical Files Reference
API Routes
/web/src/app/api/generate/route.ts (1,015 lines) - Main generation
/web/src/app/api/regenerate/route.ts (517 lines) - Re-generation
/web/src/app/api/encounters/[encounterId]/files/route.ts (261 lines) - File upload
/web/src/app/api/encounters/[encounterId]/extract/route.ts (364 lines) - Extraction
/web/src/app/api/send-note-email/route.ts (105 lines) - Email sending
Frontend Components
/web/src/components/encounters/recording-bar.tsx (412 lines) - Recording UI orchestrator
/web/src/components/encounters/review-view.tsx (1,054 lines) - Note review
/web/src/components/encounters/files-panel.tsx (333 lines) - File management
/web/src/components/encounters/draft-view.tsx (370 lines) - Draft composition
/web/src/components/encounters/processing-overlay.tsx (53 lines) - Generation progress
Hooks
/web/src/components/encounters/hooks/use-encounter-generation.ts - Generation orchestration
/web/src/components/encounters/hooks/use-audio-recorder.ts (322 lines) - MediaRecorder lifecycle
/web/src/components/encounters/hooks/use-scribe-streaming.ts (178 lines) - Scribe WebSocket + AudioWorklet
/web/src/components/encounters/hooks/use-recording-guards.ts (182 lines) - Navigation/wake/notification guards
/web/src/components/encounters/hooks/use-audio-devices.ts (50 lines) - Device enumeration
/web/src/hooks/use-generation-timer.ts - Time estimation
Verification
After Each Phase
Lint - npm run lint in web/ (no errors)
Build - npm run build (successful compilation)
Manual Test - Test affected user flows
Unit Tests - Write tests for new hooks/utilities
End-to-End Flows to Test
Flow 1: Record → Generate

Start recording
Speak for 30s
Stop recording
Click "Generate"
Verify: No recording.webm in storage
Verify: Note generated successfully
Verify: Real-time transcript used
Flow 2: Upload Files → Generate

Upload 2 images + 1 PDF
Wait for extraction to complete
Click "Generate"
Verify: All files extracted
Verify: Extracted text used in generation
Flow 3: Record + Upload → Generate

Start recording + upload image during recording
Stop recording
Click "Generate"
Verify: Both transcript and image used
Verify: No duplicate extraction
Flow 4: Regenerate with Template Change

Generate note
Switch template in review
Click "Adjust"
Verify: Note reformatted correctly
Verify: Extraction not re-run
Flow 5: Send Email

Generate note
Click "Send Email"
Verify: Email received
Verify: Magic link works
Success Metrics
RecordingBar: 1,040 → 412 lines orchestrator + 4 hooks (60% reduction in main file) ✅
ReviewView: 1,054 → ~400 lines (60% reduction)
Extraction logic: 2 implementations → 1 shared service
Storage usage: No recording.webm files after refactor
Test coverage: New hooks/utilities have unit tests
Build time: No significant increase
No regressions in user flows
