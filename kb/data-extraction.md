# MediTalk Data Extraction

_Last updated: 2026-04-15_

How raw clinical data (audio, files, doctor notes) gets into the system before the generation pipeline takes over. For the pipeline itself, see [prompt-pipeline.md](prompt-pipeline.md).

---

## 1. Recording & Transcription

### 1.1 Audio recording (client)

All recording happens inside [web/src/components/encounters/hooks/use-audio-recorder.ts](web/src/components/encounters/hooks/use-audio-recorder.ts), a single hook that abstracts web and native paths behind one interface.

- **Web path.** Uses the browser `MediaRecorder` API with native `pause()`/`resume()` to maintain a single container across pause/resume cycles — `stop()` produces one valid file containing all audio. Preferred MIME types, in order: `audio/webm;codecs=opus`, `audio/webm`, `audio/ogg;codecs=opus`, `audio/ogg`, `audio/mp4`. If none is supported (rare), the fallback is `audio/mp4` (not empty string — passing `""` as `mimeType` causes `NotSupportedError` on some browsers). At pause time on **non-mp4** codecs, `requestData()` flushes accumulated chunks before pausing — with a feature-detection guard + 500ms timeout because `requestData()` is not reliably supported on all browsers. On **mp4** (Safari / iOS), `requestData()` is **skipped entirely** — flushing an mp4 fragment mid-recording corrupts the container because subsequent fragments after resume can't be concatenated into a valid mp4 (header conflicts). Instead, `pause()` calls `recorder.pause()` directly without flushing; all data is captured in one clean blob when `stop()` fires. This means pause-time snapshots (`getSnapshotBlob()`) are empty on Safari, so `persistBlobAtPause()` skips upload+transcription on mp4. `resume()` also guards against calling `recorder.resume()` when the recorder isn't in `"paused"` state. `getSnapshotBlob()` returns the accumulated audio without stopping the recorder.
- **Native path.** On iOS/Android the Capacitor `NativeAudioStreamPlugin` captures 16 kHz PCM directly. Chunks are accumulated into a WAV file through [wav-builder.ts](web/src/lib/wav-builder.ts). `getSnapshotBlob()` returns a WAV from accumulated chunks.
- **State model.** `"idle" | "recording" | "paused"`, plus `duration`, `micError`, `nativeLevel`. Recording is **never auto-reset** — the caller must explicitly `reset()` after consuming the blob. Background mic is enabled through `UIBackgroundModes: audio` on iOS and `@capawesome-team/capacitor-android-foreground-service` on Android; see [web/src/lib/native-guards.ts](web/src/lib/native-guards.ts).

### 1.2 Recording UI & Pause-Time Upload

[web/src/components/encounters/recording-bar.tsx](web/src/components/encounters/recording-bar.tsx) wires recording, template selection, consent, and pause-time blob upload:

- `useRecordingConsent` — shows a one-time data-processing notice.
- `useAudioDevices` — mic picker.
- `useRecordingGuards` — platform permission + state guards (navigation blocking, wake lock, notifications, audio interruption auto-pause/resume).

**Batch-only architecture:** There is no progressive/VAD-based transcription. The recording runs continuously. When the doctor pauses, `persistBlobAtPause()` does two things:

1. **Uploads a snapshot blob** to Supabase storage (`encounter-files` bucket) — this is the cumulative audio so far (single container via native pause/resume on web).
2. **Fire-and-forget batch transcription** — calls `transcribeBlob(snapshot, language, visitId)` then PATCHes the result to `visits.metadata.transcript` (via the atomic metadata merge endpoint). This gives the Sources panel a live transcript preview even before generation. Failures surface a toast error via `sonner`.

**Session persistence:** Recording session state is persisted to `visits.metadata.recording_session` so it survives page refresh/navigation. When the user returns to a paused encounter, the recording bar restores the paused UI with duration and resume button. The `RecordingSession` shape:

```ts
/** Persisted to visits.metadata.recording_session */
interface RecordingSession {
  state: "recording" | "paused";
  durationAtPause: number;
  audioPath?: string; // storage path to the snapshot blob from last pause
}
```

**Session restoration:** On resume after a page refresh, `handleResume` starts a **fresh** MediaRecorder (the previous one was destroyed by the refresh). It sets `durationOffset = restoredDuration` so the timer continues where it left off. The pre-refresh audio lives at `recording_session.audioPath` in storage — it's NOT in the new recorder's buffer.

The bar exposes an imperative `finalize()` via ref that stops the recorder and returns `{ blob, isRestoredSession }`. `isRestoredSession` is `true` when `durationOffset > 0` (i.e., the session was resumed after a page refresh). This flag tells `handleGenerate` to send the pre-refresh `audioPath` to the server for recovery concatenation.

### 1.3 Transcription — ElevenLabs Scribe v2

Transcription is **Scribe v2 batch**, not Whisper. The server-side wrapper lives at [web/src/lib/elevenlabs.ts](web/src/lib/elevenlabs.ts):

```ts
transcribeAudio(file, filename, languageCode?, ctx?) -> string
```

- Model: `scribe_v2`. SDK timeout: **300s** (default was 60s — too short for long consultations).
- **Two client-side helpers** in [transcribe-blob.ts](web/src/components/encounters/hooks/transcribe-blob.ts):
  1. `transcribeFromPath(storagePath, language, visitId)` — **preferred path** for full recordings. Sends a JSON body `{ storagePath, language, visitId }` to `/api/batch-transcribe`. The server downloads from Supabase storage and transcribes. Bypasses Vercel's 4.5 MB body limit.
  2. `transcribeBlob(blob, language, visitId)` — direct FormData upload for small blobs (pause-time snapshots < 4.5 MB). Subject to Vercel body limit.
     Both include a **single retry** with 2s delay for transient HTTP errors (408, 429, 502, 503, 504) and `TypeError` (network failure).
- The upload filename is derived from the blob's actual MIME type via `blobMimeToExt()` (`audio/mp4` -> `.m4a`, `audio/ogg` -> `.ogg`, `audio/wav` -> `.wav`, default `.webm`) — critical because Safari records `audio/mp4` and sending it with a `.webm` filename confuses server-side format detection.
- The server endpoint [batch-transcribe/route.ts](web/src/app/api/batch-transcribe/route.ts) (`maxDuration: 300`) accepts two modes:
  1. **Storage path mode** (`Content-Type: application/json`) — downloads audio from Supabase storage, derives extension from the storage path, transcribes server-side.
  2. **Direct blob mode** (`Content-Type: multipart/form-data`) — receives audio as FormData. Fallback for small blobs.
- Usage is logged via `logUsage` with provider `"elevenlabs"`, operation `"transcription"`.

### 1.4 Transcript flow

**Normal path (single session):** User records -> pauses/generates -> `finalize()` stops recorder -> full blob -> uploaded to Supabase storage -> `transcribeFromPath(storagePath)` (server downloads & transcribes, bypasses Vercel 4.5 MB body limit) -> text -> sent as `transcriptText` to `/api/generate`. Falls back to direct `transcribeBlob()` if storage-path mode fails. If transcription fails entirely but a blob existed, a `toast.warning` informs the user that the note will be generated from files only.

**Restored session (page refresh mid-recording):** After a page refresh the recorder starts fresh, so the blob at generate time only contains post-refresh audio. The pre-refresh audio is at `recording_session.audioPath` in storage. `handleGenerate` in [use-encounter-generation.ts](web/src/components/encounters/hooks/use-encounter-generation.ts) detects `isRestoredSession` and sends both:

- `transcriptText` — post-refresh blob transcribed client-side
- `audioPath` — pre-refresh blob path from `visit.metadata.recording_session`

The server downloads and transcribes `audioPath`, then **prepends** it to `transcriptText` so the final transcript contains all segments in order.

**Native app recovery:** On Capacitor native apps (Android/iOS), stopping the foreground service after recording briefly disrupts the WebView's network stack — `fetch()` throws `TypeError`. If client-side transcription fails entirely (`!finalTranscript`) but the blob was successfully uploaded to storage (`uploadedPath`), `handleGenerate` and `handleAdjustGenerate` pass `uploadedPath` as `audioRecoveryPath` to `/api/generate`. If both the generate-time upload and transcription fail but `recording_session.audioPath` exists from the pause-time upload, the client falls back to that path instead. The server then downloads and transcribes it — same path as restored-session recovery.

**Pause-time transcription on native:** When recording is paused on native, the cumulative blob is uploaded to storage. Transcription uses `transcribeFromPath` (storage path -> server-side download) instead of `transcribeBlob` (FormData) to bypass Vercel's 4.5 MB body limit — native WAV recordings at 16 kHz can be 25+ MB. Web recordings use `transcribeBlob` since compressed webm/m4a blobs are typically small enough.

**Server-side audio recovery:** The `/api/generate` route independently resolves an effective audio path from three sources (in priority order): (1) client-provided `audioPath`, (2) `metadata.generation_pending.audioPath`, (3) `metadata.recording_session.audioPath`. This belt-and-suspenders approach ensures recovery works even when the client fails to pass the path. Recovery transcription includes a single retry with 2s delay for transient failures (download errors, ElevenLabs timeouts, empty transcriptions).

**Double-transcription guard:** Recovery audio transcription is only entered when: (1) the client explicitly passed `audioPath` (e.g. client transcription failed, or restored session prepend), OR (2) there is no `transcriptText` yet (full recovery needed). When the client already sent `transcriptText` (successful client-side batch transcription) AND did NOT pass `audioPath`, recovery is **skipped** — the `pendingAudioPath`/`sessionAudioPath` in metadata is the same blob the client already transcribed via `/api/batch-transcribe`, and re-transcribing it would double the transcript. The guard condition: `if (effectiveAudioPath && (audioPath || !transcriptText))`.

**No blob path:** If there is no blob (doctor-notes-only encounter, or restored session with no new recording), `transcriptText` is null. The generate route then falls back to `metadata.transcript` (saved from pause-time transcription) via `getTranscript()` from [encounters/sources.ts](web/src/lib/encounters/sources.ts). If neither `transcriptText` nor `metadata.transcript` exist, the pipeline relies on doctor notes and uploaded files alone.

### 1.5 Transcript storage

The resolved transcript text is stored in `visits.metadata.transcript` (JSONB). The legacy [transcript_chunks](web/supabase/migrations/002_visits_schema.sql) table still exists (with `embedding vector`) but is deprecated and only read as a fallback for old encounters in the regenerate route.

**Key field:** `visits.metadata.transcript` holds the full transcript text. Access it via `getTranscript()` from [encounters/sources.ts](web/src/lib/encounters/sources.ts). `visits.metadata.files` holds uploaded file metadata with extracted text. Chunking for Pass 1 happens in-memory inside the generate route.

---

## 2. File Upload & OCR

### 2.1 Upload & storage

Files are uploaded through signed URLs to the `encounter-files` Supabase storage bucket (see [004_encounter_files_bucket.sql](web/supabase/migrations/004_encounter_files_bucket.sql)). File metadata is persisted into the visit row's JSONB metadata, not a separate table:

```ts
// visits.metadata.files: FileMetadata[]
interface FileMetadata {
  id: string; // UUID
  name: string; // original filename
  type: string; // MIME type
  path: string; // bucket path
  source: "upload" | "recording";
  extracted_text: string | null;
  extraction_status: "pending" | "extracting" | "completed" | "failed";
  extraction_started_at: string | null; // ISO timestamp, set when status flips to "extracting"
  extracted_at: string | null; // ISO timestamp
  context?: string | null; // optional doctor directive for this file (see 2.6)
}
```

### 2.2 Text extraction

[web/src/lib/extraction/extract-file.ts](web/src/lib/extraction/extract-file.ts) is the shared entry point. It dispatches on file type:

| Type              | Method                                  | Model / Library                                                                                                        |
| ----------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `image/*`         | EXIF auto-rotate -> Claude Vision       | `claude-sonnet-4-6` at `temperature: 0`, `max_tokens: 8192` (via [file-extraction.ts](web/src/lib/file-extraction.ts)) |
| `application/pdf` | 5-min signed URL -> Claude document API | `claude-sonnet-4-6` at `temperature: 0`, `max_tokens: 8192` (both URL-input and base64-input paths in the same file)   |
| `audio/*`         | Scribe v2 batch transcription           | ElevenLabs                                                                                                             |

All OCR calls are pinned to `temperature: 0` so the same image/PDF always extracts to the same text — upstream determinism starts here, not at Pass 1. Language is plumbed through so all prompts and transcription hints respect the visit's `language` (`sk` / `cs` / `en`).

### 2.3 Extraction endpoints

Two routes invoke the extractor:

1. **Background extraction** at [web/src/app/api/encounters/[encounterId]/extract/route.ts](web/src/app/api/encounters/[encounterId]/extract/route.ts). Triggered right after upload (with a single client-side retry after 2s on failure). Atomically flips `extraction_status` to `"extracting"` (and sets `extraction_started_at`) before the expensive call so concurrent requests can't double-extract. Uses the RPC in [20260401120753_atomic_file_status_update.sql](web/supabase/migrations/20260401120753_atomic_file_status_update.sql). The final status-update RPC is wrapped in a **3-attempt retry with backoff** (500ms/1s/2s) — losing extracted text after a successful OCR call is expensive, so we try hard to persist it. On total failure, the text length is logged at error level for audit recovery. On success, the client dispatches an `extraction-complete` CustomEvent. The encounter page debounces this event (500ms) to batch multiple rapid extractions into a single `refreshEncounter()` call.
2. **On-demand inside generate** at [web/src/app/api/generate/route.ts](web/src/app/api/generate/route.ts). If a file arrives at generate-time with `extraction_status !== "completed"`, it's extracted inline. **Stuck extraction recovery:** before the extraction wait loop, any file with `extraction_status === "extracting"` and `extraction_started_at` older than 5 minutes (from `EXTRACTION_STUCK_THRESHOLD_MS`) is reset to `"failed"` (and `extraction_started_at` cleared) so it enters the retry path with a fresh timestamp. The wait loop polls every 500ms for up to 60s (from shared constants). Failures are collected into `extractionErrors` and reported alongside the generation response — they do _not_ kill the pipeline. The inline extraction uses a single `extractFileText` call per file (audio files receive `transcriptText` as a shortcut); duplicated audio/non-audio paths were eliminated.

### 2.4 Handoff to generation

Extracted file texts become entries in `FactExtractionInput.files`, and also prepended to `clinicalInputParts` that Pass 1 sees. Each file keeps its own `sourceIndex` so the Pass 1.5 fact extractor can anchor evidence at `[file sourceIndex=N]`.

When a file has a `context` value (see 2.6), all three prompt paths inject it as `DOCTOR'S DIRECTIVE FOR THIS FILE: <context>` immediately after the file header and before the extracted text. All three passes have explicit prompt instructions to respect directives:

- `clinicalInputParts` in [generate/route.ts](web/src/app/api/generate/route.ts) (Pass 1 input) — enforced via `PER-FILE DIRECTIVES` block in [prompts.ts](web/src/lib/clinical/prompts.ts) system prompt
- `buildFactExtractionUserMessage` in [fact-extraction.ts](web/src/lib/clinical/fact-extraction.ts) (Pass 1.5 input) — enforced via explicit user-message instruction
- `buildTemplateUserMessage` in [anthropic.ts](web/src/lib/anthropic.ts) (Pass 2 input) — enforced via `PER-FILE DIRECTIVES` rule in system prompt

### 2.5 Upload-in-flight guard

The encounter page and the adjust-drawer both block generation (and regeneration) while any file is still uploading. The helpers live in [files-panel.tsx](web/src/components/encounters/files-panel.tsx):

```ts
export function isFileUploading(file: EncounterFile): boolean;
export function hasUploadingFiles(files: EncounterFile[]): boolean;
```

`isFileUploading` deliberately excludes live-recording files (`source === "recording"`) because the recording flow has its own UX and the generate button explicitly supports starting generation during an active recording. The guard only prevents racing the generate request against in-progress uploads whose text isn't yet in `visits.metadata.files[i].extracted_text`.

### 2.6 Per-file context (doctor directives)

File: [web/src/components/encounters/file-context-dialog.tsx](web/src/components/encounters/file-context-dialog.tsx)

After a non-audio file upload completes, a dialog opens showing **all** non-audio files in the encounter (not just the newly uploaded ones) with a `Textarea` for each. The doctor can optionally write a directive per file — e.g. "Focus on liver markers", "Only use the diagnosis from this referral". Clicking **any** file in the file list also opens the same dialog.

- **Component:** `FileContextDialog` — controlled dialog (`open` / `onOpenChange`). Filters out audio/recording files internally. Seeds textareas from existing `file.context` values on open.
- **Persistence:** On save, `files-panel.tsx` updates the local files array via `onFilesChange` and fires a `PATCH /api/encounters/:id` with `metadata.files` for immediate persistence. The PATCH promise is tracked in a module-level `pendingContextSaves` Map so that `handleGenerate` / `handleAdjustGenerate` can `await awaitPendingContextSave(visitId)` before calling `/api/generate` — this prevents a race where the user saves context and immediately generates before the PATCH lands in the database.
- **Context indicator:** Files with a non-empty `context` show a small info icon in the file list.
- **Prompt integration:** The `context` string flows through all three prompt builders as `DOCTOR'S DIRECTIVE FOR THIS FILE: <context>` (see 2.4). This leverages the existing "doctor notes as directives" pattern (see 3.4) but scoped per-file rather than globally.

---

## 3. Doctor Notes

### 3.1 UI

Doctor notes are entered inside the encounter page at [web/src/app/[locale]/(app)/encounters/[visitId]/page.tsx](<web/src/app/[locale]/(app)/encounters/[visitId]/page.tsx>). A single multi-line input feeds the page-level state and a debounced save.

### 3.2 Autosave

Two-second debounce: the text is saved to `visits.metadata.doctor_notes` (JSONB string) via the atomic metadata merge endpoint after the doctor stops typing. Focus-out also triggers a save. There is **no** separate `doctor_notes` table.

**Save status feedback:** The [useSaveStatus](web/src/hooks/use-save-status.ts) hook tracks `"idle" | "saving" | "saved" | "error"` state. On failure, a single retry fires after 3s. The status is rendered in DraftView as a subtle inline indicator next to the date/status badge.

### 3.3 Downstream

In the generate route, `doctorNotes` becomes:

- Part of `FactExtractionInput.doctorNotes` in Pass 1.5 (Haiku tags its facts with `source.type = "doctor_notes"`, `sourceIndex = 0`).
- A `DOCTOR'S ADDITIONAL NOTES` block appended to the Opus user message in [web/src/lib/anthropic.ts](web/src/lib/anthropic.ts).

Doctor notes are treated as **high-trust source material** — they are never chunked, never embedded, and never truncated.

### 3.4 Doctor notes as directives

Doctor notes can contain not only clinical content but also **processing instructions** — e.g. "only use the blood pressure values from the uploaded file", "ignore the old diagnosis in the referral". When present, these instructions are treated as authoritative directives:

- **Pass 2 (Opus):** Rule 3a (DOCTOR NOTES AS DIRECTIVES) in [anthropic.ts](web/src/lib/anthropic.ts) explicitly tells the model to follow filtering/processing instructions in doctor notes and omit any information the doctor excluded — even at the cost of completeness.
- **Pass 1.5 (Haiku):** The fact extraction user message in [fact-extraction.ts](web/src/lib/clinical/fact-extraction.ts) includes an `IMPORTANT` instruction to respect doctor-note filtering directives — only extracting the permitted facts from files when doctor notes say to restrict scope.

---

## 4. Edge Cases & Recovery

| Scenario                                                            | Resolution                                                                                                           |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Safari recording `audio/mp4` but upload filename says `.webm`       | `blobMimeToExt()` derives filename from blob's actual MIME type; server fallback is `.m4a`                           |
| `requestData()` corrupting mp4 container on Safari iOS              | `requestData()` skipped on mp4 — `pause()` calls `recorder.pause()` directly; all data in one clean blob on `stop()` |
| `getSupportedMimeType()` returning `""` on exotic browsers          | Fallback returns `"audio/mp4"` instead of empty string to avoid `NotSupportedError`                                  |
| Long recordings (>4.5 MB) failing transcription (Vercel body limit) | Blob uploaded to storage first; `transcribeFromPath` sends storage path via JSON — server downloads directly         |
| ElevenLabs SDK timeout on long recordings                           | SDK `timeoutInSeconds` set to 300 (default was 60). Server `maxDuration` also 300s                                   |
| Native foreground-service teardown disrupting WebView network       | `audioRecoveryPath = uploadedPath` safety net — server downloads and transcribes from storage                        |
| Server-side recovery re-transcribing already-transcribed audio      | Double-transcription guard: skips when client sent `transcriptText` without `audioPath`                              |
| File context save racing with generation (directive lost)           | `pendingContextSaves` Map + `awaitPendingContextSave()` before `/api/generate`                                       |
| Doctor notes auto-save failing silently                             | `useSaveStatus` hook with visual indicator + single retry after 3s                                                   |
| File extraction getting stuck (server crash mid-extraction)         | Generate route resets files stuck in `"extracting"` > 5 min to `"failed"` for retry                                  |
| Extract RPC failing after successful OCR (lost extracted text)      | 3-attempt retry with backoff (500ms/1s/2s) on the final status update RPC                                            |
| Client-side transcription failing on network hiccup                 | Both `transcribeBlob` and `transcribeFromPath` retry once with 2s delay for transient errors                         |
| Multiple files finishing extraction at once (redundant refreshes)   | 500ms debounce on `extraction-complete` event handler batches into single `refreshEncounter()`                       |
| Transcription misspelling medication names                          | Fuzzy matching via `correctMedicationName` auto-corrects in Pass 1.6a using Levenshtein distance                     |

---

_This document is checked into the repo at [kb/data-extraction.md](kb/data-extraction.md). For the generation pipeline, see [prompt-pipeline.md](prompt-pipeline.md)._
