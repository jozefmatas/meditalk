# MediTalk Note-Generation Engine

_Last updated: 2026-04-09_

This document is the **canonical reference** for how a medical encounter turns into a finalized clinical note in MediTalk. It exists so we can refine, refactor, and debug the pipeline without having to re-derive its shape from source code every time.

Read this first before touching anything in [web/src/app/api/generate/route.ts](web/src/app/api/generate/route.ts), [web/src/app/api/regenerate/route.ts](web/src/app/api/regenerate/route.ts), [web/src/lib/clinical/](web/src/lib/clinical/), or [web/src/lib/anthropic.ts](web/src/lib/anthropic.ts).

---

## 0. TL;DR — The Engine in One Diagram

```
┌────────────────────────── INTAKE ──────────────────────────┐
│                                                             │
│  🎙  Audio recording  ─────► ElevenLabs Scribe v2          │
│      (Web: MediaRecorder +                  (real-time      │
│       AudioWorklet;                          streaming or   │
│       Native: Capacitor                      batch)         │
│       PCM plugin)                             │             │
│                                               ▼             │
│  📎  File uploads  ─────► Claude Vision / PDF / Scribe     │
│      (images, PDFs,        (extractFileText)               │
│       audio files)             │                            │
│                                ▼                            │
│  ✍️   Doctor notes  ─────► visits.metadata.doctor_notes    │
│      (debounced autosave)                                   │
│                                                             │
└─────────────────────────────┬───────────────────────────────┘
                              ▼
┌─────────────────── GENERATION PIPELINE ────────────────────┐
│                                                             │
│  Pass 1  ─ runClinicalAnalysis       Sonnet 4.6  (t=0)     │
│           → matchedConcepts, candidateIcdCodes,             │
│             inferredSpecialty, problemClusters              │
│                                                             │
│  Pass 1.5 ─ runFactExtraction         Haiku 4.5  (t=0)     │
│           → ExtractedFacts (10 categories), each with       │
│             verbatim evidence quote pointing at a source    │
│                                                             │
│  Pass 1.6a ─ validateFacts            pure TS              │
│            → drop facts whose evidence isn't in the         │
│              claimed source (cross-source fallback)         │
│                                                             │
│  Pass 1.6b ─ resolveFacts             pure TS              │
│            → drop facts replaced by speaker corrections     │
│              ("vlastne", "sorry, 2 ribs", ", nie,")        │
│                                                             │
│  Pass 1.7 ─ filterCertainIcdCandidates  pure TS  ◄── NEW   │
│           → drop ICD candidates not lexically grounded      │
│             in diagnoses/history facts                      │
│                                                             │
│  Prompt  ─ buildTemplateSystemPrompt + buildEnriched...     │
│          → system prompt = template + specialty pack +      │
│            filtered ICDs + concepts + clusters              │
│          → user msg  = validated facts (contract) +         │
│            numbered source material                         │
│                                                             │
│  Pass 2  ─ generateFromTemplate       Opus 4.6   (t=0)     │
│           → streamed SSE of section JSON → HTML note +      │
│             patient letter + title                          │
│                                                             │
│  Pass 2.5 ─ extractIcdCodesFromSections + defensive filter  │
│           → strip any ungrounded ICD Opus snuck in          │
│                                                             │
└─────────────────────────────┬───────────────────────────────┘
                              ▼
┌─────────────────────── PERSIST + REVIEW ───────────────────┐
│                                                             │
│  💾  Save to visits: encounter_note, patient_letter,       │
│      clinical_analysis, generation_fingerprint,             │
│      generation_history[], status = "to_review"             │
│                                                             │
│  📝  Doctor reviews, edits, regenerates if needed           │
│      (regenerate = same pipeline; fast reformat path        │
│       if only template changed)                             │
│                                                             │
│  ✅  Finalize  → status = "finalized"                       │
│      📧  Optional email dispatch                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Key guarantees:**

1. **Every fact has verbatim evidence.** Pass 1.5 refuses to emit a fact without a quote; Pass 1.6a drops any fact whose quote isn't in the source.
2. **Every ICD code is grounded.** Pass 1.7 drops candidates that aren't lexically rooted in `diagnoses`/`history` facts; Pass 2.5 defensively strips any Opus snuck past the prompt.
3. **Same inputs → same outputs** for the entire post-Pass-1 pipeline. Pass 1 LLM noise is absorbed by deterministic downstream gates.
4. **No hallucinated clinical content.** Opus is told: _"these are the ONLY codes you may emit; the validated facts are the factual contract."_

---

## 1. Intake — Recording & Transcription

### 1.1 Audio recording (client)

All recording happens inside [web/src/components/encounters/hooks/use-audio-recorder.ts](web/src/components/encounters/hooks/use-audio-recorder.ts), a single hook that abstracts web and native paths behind one interface.

- **Web path.** Uses the browser `MediaRecorder` API. Preferred MIME types, in order: `audio/webm`, `audio/ogg`, `audio/mp4`. The full recording blob is batch-transcribed via `/api/batch-transcribe` at generation time.
- **Native path.** On iOS/Android the Capacitor `NativeAudioStreamPlugin` captures 16 kHz PCM directly. Chunks are accumulated into a WAV file through [wav-builder.ts](web/src/lib/wav-builder.ts). The resulting blob is batch-transcribed at generation time.
- **State model.** `"idle" | "recording" | "paused"`, plus `duration`, `micError`, `nativeLevel`. Recording is **never auto-reset** — the caller must explicitly `reset()` after consuming the blob. Background mic is enabled through `UIBackgroundModes: audio` on iOS and `@capawesome-team/capacitor-android-foreground-service` on Android; see [web/src/lib/native-guards.ts](web/src/lib/native-guards.ts).

### 1.2 Recording UI

[web/src/components/encounters/recording-bar.tsx](web/src/components/encounters/recording-bar.tsx) wires recording, template selection, and consent:

- `useRecordingConsent` — shows a one-time data-processing notice.
- `useAudioDevices` — mic picker.
- `useRecordingGuards` — platform permission + state guards.

The bar exposes an imperative `finalize()` that stops recording and returns `{ blob }` to the caller. There is no real-time streaming — all transcription is batch-only.

### 1.3 Transcription — ElevenLabs Scribe v2

Transcription is **Scribe v2 batch**, not Whisper. The server-side wrapper lives at [web/src/lib/elevenlabs.ts](web/src/lib/elevenlabs.ts):

```ts
transcribeAudio(file, filename, languageCode?, ctx?) → string
```

- Model: `scribe_v2`.
- The recorded audio blob is POSTed to `/api/batch-transcribe` as `multipart/form-data`, which calls `speechToText.convert` with the visit's language. The returned text is sent to `/api/generate` as `transcriptText`.
- The client-side helper is [transcribeBlob](web/src/components/encounters/hooks/transcribe-blob.ts), called from [use-encounter-generation.ts](web/src/components/encounters/hooks/use-encounter-generation.ts) in both `handleGenerate` and `handleAdjustGenerate`.
- Usage is logged via `logUsage` with provider `"elevenlabs"`, operation `"transcription"`.
- Tests: [transcribe-blob.test.ts](web/src/components/encounters/hooks/transcribe-blob.test.ts) (4 cases covering success, server error, empty response, network failure).

### 1.4 Transcript flow

Simple: blob → `transcribeBlob()` → text → `/api/generate`. If there is no blob (doctor-notes-only encounter), `transcriptText` is null and the pipeline relies on doctor notes and uploaded files alone.

### 1.5 Transcript storage

The resolved transcript text ends up on the visit row itself; chunking for embeddings happens only when Pass 1 needs the transcript split. The legacy [transcript_chunks](web/supabase/migrations/002_visits_schema.sql) table still exists (with `embedding vector`) but is no longer the primary path for new encounters.

**Key field:** `visits.raw_text` holds the full transcript; `visits.metadata.files` holds any uploaded audio as files; chunking for Pass 1 happens in-memory inside the generate route.

---

## 2. Intake — File Upload & OCR

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
  extracted_at: string | null; // ISO timestamp
}
```

### 2.2 Text extraction

[web/src/lib/extraction/extract-file.ts](web/src/lib/extraction/extract-file.ts) is the shared entry point. It dispatches on file type:

| Type              | Method                                 | Model / Library                                                                                                        |
| ----------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `image/*`         | EXIF auto-rotate → Claude Vision       | `claude-sonnet-4-6` at `temperature: 0`, `max_tokens: 8192` (via [file-extraction.ts](web/src/lib/file-extraction.ts)) |
| `application/pdf` | 5-min signed URL → Claude document API | `claude-sonnet-4-6` at `temperature: 0`, `max_tokens: 8192` (both URL-input and base64-input paths in the same file)   |
| `audio/*`         | Scribe v2 batch transcription          | ElevenLabs                                                                                                             |

All OCR calls are pinned to `temperature: 0` so the same image/PDF always extracts to the same text — upstream determinism starts here, not at Pass 1. Language is plumbed through so all prompts and transcription hints respect the visit's `language` (`sk` / `cs` / `en`).

### 2.3 Extraction endpoints

Two routes invoke the extractor:

1. **Background extraction** at [web/src/app/api/encounters/[encounterId]/extract/route.ts](web/src/app/api/encounters/[encounterId]/extract/route.ts). Triggered right after upload. Atomically flips `extraction_status` to `"extracting"` before the expensive call so concurrent requests can't double-extract. Uses the RPC in [20260401120753_atomic_file_status_update.sql](web/supabase/migrations/20260401120753_atomic_file_status_update.sql).
2. **On-demand inside generate** at [web/src/app/api/generate/route.ts](web/src/app/api/generate/route.ts). If a file arrives at generate-time with `extraction_status !== "completed"`, it's extracted inline. Failures are collected into `extractionErrors` and reported alongside the generation response — they do _not_ kill the pipeline.

### 2.4 Handoff to generation

Extracted file texts become entries in `FactExtractionInput.files`, and also prepended to `clinicalInputParts` that Pass 1 sees. Each file keeps its own `sourceIndex` so the Pass 1.5 fact extractor can anchor evidence at `[file sourceIndex=N]`.

### 2.5 Upload-in-flight guard

The encounter page and the adjust-drawer both block generation (and regeneration) while any file is still uploading. The helpers live in [files-panel.tsx](web/src/components/encounters/files-panel.tsx):

```ts
export function isFileUploading(file: EncounterFile): boolean;
export function hasUploadingFiles(files: EncounterFile[]): boolean;
```

`isFileUploading` deliberately excludes live-recording files (`source === "recording"`) because the recording flow has its own UX and the generate button explicitly supports starting generation during an active recording. The guard only prevents racing the generate request against in-progress uploads whose text isn't yet in `visits.metadata.files[i].extracted_text`.

---

## 3. Intake — Doctor Notes

### 3.1 UI

Doctor notes are entered inside the encounter page at [web/src/app/[locale]/(app)/encounters/[visitId]/page.tsx](<web/src/app/[locale]/(app)/encounters/[visitId]/page.tsx>). A single multi-line input feeds the page-level state and a debounced save.

### 3.2 Autosave

Two-second debounce: the text is saved to `visits.metadata.doctor_notes` (JSONB string) after the doctor stops typing. Focus-out also triggers a save. There is **no** separate `doctor_notes` table.

### 3.3 Downstream

In the generate route, `doctorNotes` becomes:

- Part of `FactExtractionInput.doctorNotes` in Pass 1.5 (Haiku tags its facts with `source.type = "doctor_notes"`, `sourceIndex = 0`).
- A `DOCTOR'S ADDITIONAL NOTES` block appended to the Opus user message in [web/src/lib/anthropic.ts](web/src/lib/anthropic.ts).

Doctor notes are treated as **high-trust source material** — they are never chunked, never embedded, and never truncated.

---

## 4. Templates

### 4.1 Shape

```ts
// web/src/lib/templates/types.ts
interface Template {
  id: string;
  name: Record<string, string>; // i18n
  description: Record<string, string>; // i18n
  sections: TemplateSection[]; // hierarchical
  systemPrompt?: string; // optional full override
  styleExamples?: { name: string; text: string }[];
  styleGuide?: string; // appended to system prompt
  specialties?: string[];
  locales?: string[];
  isSystem?: boolean;
  sourceTemplateId?: string;
}

interface TemplateSection {
  id: string;
  labels: Record<string, string>; // i18n per-locale label
  context?: string; // section-specific guidance
  subsections?: TemplateSection[];
}
```

### 4.2 Sources

- **Built-in templates** are static in [web/src/lib/templates/default-templates.ts](web/src/lib/templates/default-templates.ts) (SOAP plus specialty variants). `isSystem: true`.
- **User templates** live in the Supabase `templates` table ([006_templates.sql](web/supabase/migrations/006_templates.sql), with hash IDs in [008](web/supabase/migrations/008_templates_hash_ids.sql), locales in [010](web/supabase/migrations/010_template_locales.sql), style guide in [011](web/supabase/migrations/011_template_style_guide.sql), usage tracking in [012](web/supabase/migrations/012_template_usage.sql)).

### 4.3 Resolution

`resolveTemplate(id)` in [web/src/lib/templates/index.ts](web/src/lib/templates/index.ts) looks up the DB first, then falls back to static defaults. A missing ID resolves to `DEFAULT_TEMPLATE_ID`.

### 4.4 Section contexts and labels

Two helpers flatten the hierarchy into what the prompt needs:

- `buildSectionLabelsFromTemplate(template, language)` → `Record<sectionId, label>` used to render section headers in the final HTML.
- `buildSectionContextsFromTemplate(template, language)` → `Record<sectionId, contextString>` for per-section guidance passed to Opus.

Section-specific guidance takes precedence over general rules per the system prompt instructions in [web/src/lib/anthropic.ts](web/src/lib/anthropic.ts) (see `buildTemplateSystemPrompt` at the top of the file).

### 4.5 System prompt assembly for templates

`buildTemplateSystemPrompt(template, language, sectionLabels, sectionContexts)` produces the base prompt. It interpolates `{{sections}}`, `{{language}}`, `{{languageCode}}`, and optionally `{{styleGuide}}`, or returns the template's custom `systemPrompt` verbatim if one is set.

The base prompt enforces core rules: insufficient context check, strict grounding, no-assumption mode, per-section priority, language lock, missing-section handling, formatting, JSON output shape (keys per section plus `letter` and `title`), title length/consistency rules.

---

## 5. Pass 1 — Clinical Analysis

File: [web/src/lib/clinical/pipeline.ts:46](web/src/lib/clinical/pipeline.ts#L46)
Model: `claude-sonnet-4-6`, temperature 0, `max_tokens: 4096`

### 5.1 Why Sonnet not Haiku

Haiku 4.5 failed to distinguish anatomically-specific ICD codes (e.g. `I21.0` anterior wall vs `I21.2` other sites). Sonnet 4.6 reads the expanded 15-entries-per-category ICD reference reliably.

### 5.2 Inputs

- `chunks: string[]` — transcript segments joined with `\n\n` for the prompt.
- `language: SupportedLanguage` — drives regional-term and concept-trigger references.

### 5.3 What Pass 1 does

Driven by [web/src/lib/clinical/prompts.ts](web/src/lib/clinical/prompts.ts):

1. **Match clinical concepts** using triggers + regional terms from [clinical-concepts.ts](web/src/lib/clinical/clinical-concepts.ts) and [regional-terms.ts](web/src/lib/clinical/regional-terms.ts).
2. **Infer specialty** (one of ~14 `SpecialtyId` values, with an optional secondary).
3. **Cluster problems** — group related concepts by axis.
4. **Suggest ICD-10 codes** with `confidence: "high" | "medium" | "low"` and `sourceConceptIds` back-references.
5. **Extract medication names** as mentioned (not resolved).

### 5.4 Output shape

```ts
// web/src/lib/clinical/types.ts
interface ClinicalAnalysis {
  matchedConcepts: MatchedConcept[];
  inferredSpecialty: SpecialtyId;
  secondarySpecialty?: SpecialtyId;
  problemClusters: ProblemCluster[];
  candidateIcdCodes: CandidateIcdCode[];
  mentionedMedications: string[];
  usage: { inputTokens: number; outputTokens: number };
}

interface CandidateIcdCode {
  code: string;
  description: string;
  confidence: "high" | "medium" | "low";
  sourceConceptIds: string[];
}
```

### 5.5 Supporting indexes

- **ICD index** — [icd-index.ts](web/src/lib/clinical/icd-index.ts). Loads the canonical ICD-10 CSV per locale; provides `buildIcdReferenceForConcepts`, `resolveIcdCodes`, `extractIcdCodesFromSections`, `validateIcdDescriptions`.
- **Medication index** — [medication-index.ts](web/src/lib/clinical/medication-index.ts). Provides `searchMedications`, `isValidMedication`, regional brand/generic mapping.
- **Specialty prompts** — [specialty-prompts.ts](web/src/lib/clinical/specialty-prompts.ts). Loads per-specialty addenda (terminology, emphasized sections) used in Pass 2 prompt enrichment.

### 5.6 Where it runs in the route

In parallel with embedding-based chunk retrieval:

```ts
const [embeddingResult, rawClinicalAnalysis] = await Promise.all([
  embeddingPromise,
  clinicalPromise,
]);
let clinicalAnalysis: ClinicalAnalysis | null = rawClinicalAnalysis;
```

The `let` is important — Pass 1.7 rewrites `candidateIcdCodes` on the analysis object before the prompt is built.

---

## 6. Pass 1.5 — Structured Fact Extraction

File: [web/src/lib/clinical/fact-extraction.ts:220](web/src/lib/clinical/fact-extraction.ts#L220)
Model: `claude-haiku-4-5-20251001`, temperature 0, `max_tokens: 16384`

### 6.1 Why this pass exists

Pass 2 (Opus) is much more grounded when it sees a terse, category-bucketed list of facts with verbatim evidence. Instead of asking Opus to both interpret the transcript _and_ write prose, we turn the transcript into a structured contract first and then tell Opus _"these facts are the truth; do not go beyond them."_

### 6.2 Input

```ts
interface FactExtractionInput {
  chunks: string[]; // transcript chunks
  doctorNotes?: string;
  files?: { name: string; type: string; text: string }[]; // OCR'd
}
```

The user message numbers every source:

- `[transcript sourceIndex=0]: ...`
- `[file sourceIndex=0 name="labs.pdf" type="application/pdf"]: ...`
- `[doctor_notes sourceIndex=0]: ...`

### 6.3 Output — `ExtractedFacts`

Ten fixed categories, all arrays of `ExtractedFact`:

```
demographics, chiefComplaint, symptoms, findings, measurements,
diagnoses, medications, procedures, history, plan
```

```ts
interface ExtractedFact {
  category: FactCategory;
  value: string; // ≤120 chars, clinical phrasing
  source: {
    type: "transcript" | "doctor_notes" | "file";
    sourceIndex: number; // 0-based into the labeled sources
    evidence: string; // ≤120 chars verbatim quote
  };
}
```

### 6.4 Prompt rules that matter

From [fact-extraction.ts:127-173](web/src/lib/clinical/fact-extraction.ts#L127-L173):

1. Only facts **explicitly** stated — no inference, no typical-clinical-detail fill-ins.
2. Every fact MUST include a **verbatim** evidence quote. Paraphrasing is disallowed.
3. Never upgrade severity (`"ACS"` stays `"ACS"`, never becomes `"STEMI"`).
4. Preserve uncertainty markers (`"suspected"`, `"possible"`, `"rule out"`).
5. Measurements: include units **as stated**, never invent units.
6. Plan vs history vs diagnoses separation is strict.
7. **Self-correction rule:** Emit BOTH the pre-correction and corrected value as separate facts, each with its own evidence. A deterministic downstream step (Pass 1.6b) decides which one to keep. Applies to `"actually"`, `"sorry"`, `"vlastne"`, `"opravujem sa"`, and punctuation-bracketed negations like `", nie,"`.
8. **NO-ASSUMPTION mode:** If a numeric value is stated without a unit/dimension (`"fajčí 15"` with no `"cigariet/deň"` and no `"rokov"`), preserve the raw number and mark as `"(jednotka nešpecifikovaná)"` / `"(jednotka neuvedena)"` / `"(unit not specified)"` depending on locale. Never guess the most common interpretation.

### 6.5 Empty-input short-circuit

If `chunks`, `files`, and `doctorNotes` are all empty, the function returns `emptyExtractedFacts()` without an API call.

### 6.6 Defensive coercion

`coerceFact(raw, expectedCategory)` (exported for testing) strips malformed entries: missing value, missing/invalid source type, non-numeric or negative `sourceIndex`, missing evidence. Anything that fails coercion is silently dropped — the Haiku response can be partially malformed without blowing up the pipeline.

---

## 7. Pass 1.6 — Fact Validation & Resolution

### 7.1 `validateFacts` — evidence-in-source enforcement

File: [web/src/lib/clinical/fact-validator.ts:145](web/src/lib/clinical/fact-validator.ts#L145)

Pure TypeScript. For every fact, check that `evidence` actually appears in the source it claims to come from. The matcher is intentionally fuzzy because Haiku can paraphrase whitespace or ordering slightly:

1. **Normalize** both sides via `normalizeForMatch` — Unicode NFKD, strip combining marks, lowercase, collapse non-alphanumerics to spaces. This is locale-agnostic and handles `sk`/`cs`/`en` uniformly.
2. **First pass:** does normalized evidence appear as a substring of the normalized source?
3. **Second pass:** do all content tokens (≥3 chars) from the evidence appear in the source **in order**?
4. **Cross-source fallback:** if the claimed source doesn't contain the evidence, try every other source. This rescues cases where Haiku mislabels `transcript` vs `file` (common when a file is itself an audio transcription). On success, the fact's source reference is updated in place.

Output is `ValidationResult`:

```ts
interface ValidationResult {
  validFacts: ExtractedFacts;
  removedFacts: RemovedFact[];
  warnings: string[];
  counts: { total: number; removed: number; recoveredByFallback: number };
}
```

Removal reasons: `evidence_not_in_source`, `source_index_out_of_range`, `duplicate` (dedup by `normalizeForMatch` within category), `empty_value`.

**Medications** also get validated against the approved list via `isValidMedication`. Failures produce warnings only — we never drop a medication just because the index doesn't know about it. The index is advisory.

### 7.2 `resolveFacts` — deterministic correction detection

File: [web/src/lib/clinical/fact-resolver.ts:183](web/src/lib/clinical/fact-resolver.ts#L183)

Pure TypeScript. Drops facts that were replaced by the speaker. Rule-based, 100% deterministic.

**Detection:** for each fact, find its evidence quote in the source and look ahead ~120 chars for either:

- A curated **correction phrase** (`"vlastne"`, `"pardon"`, `"opravujem sa"`, `"nie, skor"`, `"actually"`, `"sorry"`, `"i mean"`, `"correction"`, `"strike that"`, Czech/Slovak/English curated lists in [fact-resolver.ts:65-123](web/src/lib/clinical/fact-resolver.ts#L65)), or
- A **punctuation-bracketed negation** matched by `/[,;.:—–-]\s*(nie|ne|no|nein|non|nej|neni|nicht)\s*[,;.:—–-]/iu`. This catches bare `, nie,` without swallowing legitimate negations that start a sentence.

**What it does NOT do:** numeric last-mention-wins deduplication. That rule wrongly collapsed legitimate time-series (multiple BP readings at different times). Exact duplicates are already removed by `validateFacts`; nothing else should be merged here.

Output is a `ResolutionResult` with a list of `ResolutionEvent`s recording which facts were dropped and why.

### 7.3 `countFacts` / `computeFingerprint`

- `countFacts(facts)` — sums all categories, used for telemetry.
- `computeFingerprint(...)` (in [fingerprint.ts](web/src/lib/clinical/fingerprint.ts)) — SHA-256 over transcript + doctor notes + files + clinical analysis + validated facts + system prompt + user message. Stored on the visit so we can detect drift between regenerations. `diffFingerprints(a, b)` tells us which stage changed.

---

## 8. Pass 1.7 — ICD Certainty Filter (NEW)

File: [web/src/lib/clinical/icd-certainty.ts](web/src/lib/clinical/icd-certainty.ts)
Tests: [web/src/lib/clinical/icd-certainty.test.ts](web/src/lib/clinical/icd-certainty.test.ts) — 27 tests, covering the user's EMS regression

### 8.1 Problem it solves

Pass 1 (Sonnet 4.6 at temperature 0) is NOT strictly deterministic. The prompt explicitly allows ICD codes "based on clinical context," which means labs and symptoms can promote a related code into the candidate list even when the doctor never diagnosed that condition. Opus then arbitrarily includes or omits those weak candidates — producing different Záver/Assessment lists on each run.

Concrete repro from the user:

- Run 1: `I21.2 + I10 + R07.2 + E11.91` (chest-pain symptom code plus inferred decompensated DM)
- Run 2: `I21.2 + I10` (clinically correct minimum)

### 8.2 Rule

A candidate ICD code is **certain** iff at least one token from a grounded `diagnoses` or `history` fact substring-matches the normalized ICD description, OR a token from the ICD description substring-matches a grounded fact value. `chiefComplaint`, `symptoms`, `findings`, `measurements` are **deliberately NOT** used as grounding sources — if the only evidence is "chest pain" we emit the underlying MI (`I21.2`) but never the symptom code (`R07.2`).

### 8.3 Matcher internals

- **Token extraction** ([icd-certainty.ts:163](web/src/lib/clinical/icd-certainty.ts#L163)): split normalized text on whitespace, drop a cross-locale stop-word set, drop tokens shorter than 4 chars unless they are on the clinical abbreviation whitelist (`IM`, `HT`, `DM`, `ACS`, `MI`, `IBS`, `CMP`, `TIA`, `CABG`, `PCI`, `COPD`, `CHOPN`, `STEMI`, `NSTEMI`, `ASTMA`, `ASTHMA`, `CHF`, `AFIB`, `AMI`, `CV`).
- **Stemming** ([icd-certainty.ts:174](web/src/lib/clinical/icd-certainty.ts#L174)): truncate tokens longer than 6 chars to the first 6 so `hypertenzia`/`hypertenzie`/`hypertenze`/`hypertension` all share the stem `hypert`. This is crude but works across `sk`/`cs`/`en` without per-locale wiring.
- **Bidirectional match** ([icd-certainty.ts:184](web/src/lib/clinical/icd-certainty.ts#L184)): check fact→ICD AND ICD→fact so the filter is tolerant to whichever side carries the more specific terminology.

### 8.4 Output

```ts
interface CertaintyFilterResult {
  kept: CandidateIcdCode[];
  dropped: { candidate: CandidateIcdCode; reason: DropReason }[];
  counts: { total: number; kept: number; dropped: number };
}
type DropReason = "no_diagnosis_facts" | "no_matching_token";
```

### 8.5 Where it runs

In both routes, **immediately after** fact resolution and **before** `buildEnrichedSystemPrompt`:

- [web/src/app/api/generate/route.ts:464-482](web/src/app/api/generate/route.ts#L464)
- [web/src/app/api/regenerate/route.ts:283-299](web/src/app/api/regenerate/route.ts#L283)

The filter rewrites `clinicalAnalysis.candidateIcdCodes` in place so everything downstream (prompt, extraction, metadata) sees the filtered list.

### 8.6 Guarantees

- **Pure function.** Does not mutate its inputs. Same inputs → same output every run.
- **Confidence-independent.** A Pass 1 `high`-confidence candidate with no fact support is still dropped; a `low`-confidence candidate with fact support is kept.
- **Empty-safe.** Empty diagnoses + history facts → drop every candidate with reason `no_diagnosis_facts`. Safer to emit an empty Záver than hallucinated codes.

---

## 9. Prompt Assembly for Pass 2

### 9.1 Enriched system prompt

File: [web/src/lib/clinical/pipeline.ts:123](web/src/lib/clinical/pipeline.ts#L123) — `buildEnrichedSystemPrompt`

The base template prompt gets augmented with:

1. **Specialty prompt pack** — addendum, terminology notes, emphasized sections from [specialty-prompts.ts](web/src/lib/clinical/specialty-prompts.ts).
2. **Medication verification block** — exact names resolved against the approved medication index. Missing matches are included as warnings so Opus can hedge.
3. **CANDIDATE ICD-10 CODES** — the **filtered** list from Pass 1.7 with a hard constraint:

   > _"these are the ONLY codes you may emit in this report. Use EXACT descriptions as written below. Do NOT paraphrase, combine, or modify descriptions. Do NOT add any other ICD codes, even if labs, vital signs, or symptoms suggest them — any code not in this list has already been judged insufficiently grounded by a deterministic certainty filter and MUST NOT appear anywhere in your output"_

4. **Matched clinical concepts** and **problem clusters** — hints for structuring the Assessment section.

### 9.2 User message

File: [web/src/lib/anthropic.ts:133](web/src/lib/anthropic.ts#L133) — `buildTemplateUserMessage`

Block order:

1. **VALIDATED CLINICAL FACTS** — `formatFactsForPrompt(validatedFacts)` renders the 10 categories as a terse bullet list. This is introduced as the _factual contract_: every statement in the report must trace back to one of these facts.
2. **SOURCE MATERIAL** — numbered transcript chunks. When facts are present, these are marked "phrasing and context reference only" — Opus should not extract new facts from them, only phrasing.
3. **UPLOADED FILE CONTENTS** — numbered extracted texts.
4. **DOCTOR'S ADDITIONAL NOTES** — verbatim.
5. Final instruction: return a single JSON object with one key per section ID, plus `letter` and `title`.

### 9.3 Output contract

Opus is required to return JSON keyed by section IDs from the template plus:

- `letter` — a patient-friendly summary letter (HTML).
- `title` — ≤6 words, must be consistent with the primary diagnosis in the Assessment/Záver section.

---

## 10. Pass 2 — Generation

File: [web/src/lib/anthropic.ts](web/src/lib/anthropic.ts) — `generateFromTemplate`

- **Model:** `claude-opus-4-6` with fallback chain through Sonnet 4.6 / Sonnet 4.5 / Sonnet 4.20250514.
- **Temperature:** 0.
- **Max tokens:** 8192.
- **Streaming:** SSE to the client.

### 10.1 Fingerprint capture

The exact `systemPrompt` and `userMessage` strings are returned so we can fingerprint them alongside the inputs and the outputs. This lets us detect whether a drift between two runs is a prompt-side change (our bug) or an LLM-sampling change (model noise).

### 10.2 Streaming protocol

The route uses the SSE helpers in [web/src/lib/api/sse.ts](web/src/lib/api/sse.ts):

```ts
createSSEStream(start: (helpers) => void | Promise<void>): ReadableStream
sseResponse(readable: ReadableStream): Response
extractSectionsFromStream(accumulated, sectionIds, emittedSections, sectionLabels, onSection)
```

Event types emitted to the client during a generation:

| Event               | Payload                                          | When                          |
| ------------------- | ------------------------------------------------ | ----------------------------- |
| `analysis_complete` | `{ concepts, icdCodes, medications }` counts     | After Pass 1                  |
| `facts_extracted`   | `{ facts: ExtractedFacts, counts }`              | After Pass 1.5/1.6/1.7        |
| `streaming_start`   | `{}`                                             | Right before Opus starts      |
| `section`           | `{ id, title, content }`                         | Each time a section completes |
| `complete`          | `{ note, letter, title, analysis, fingerprint }` | Final payload                 |
| `error`             | `{ message }`                                    | On failure                    |

The `section` events let the UI fill in the note progressively as Opus writes it.

### 10.3 Sections come from one prompt

There is **one** generation call per pipeline run, not one per section. The model returns a single JSON object; sections are extracted as they arrive by `extractSectionsFromStream` scanning for closing brackets of each known key.

---

## 11. Pass 2.5 — Post-Generation (NEW)

### 11.1 ICD extraction

`extractIcdCodesFromSections` in [web/src/lib/clinical/icd-index.ts](web/src/lib/clinical/icd-index.ts) scans the generated section texts for lines matching `- CODE Description` or `CODE Description`. It returns a `CandidateIcdCode[]` using the **canonical** descriptions from the ICD CSV (via `validateIcdDescriptions`), so even if Opus paraphrased we persist the correct description.

### 11.2 Defensive certainty filter

File: [web/src/lib/anthropic.ts](web/src/lib/anthropic.ts) — runs immediately after `extractIcdCodesFromSections`.

Rule: if the original `clinicalAnalysis.candidateIcdCodes` was passed in (which it always is in production), intersect the extracted codes with that set. Anything not in the set is:

1. **Removed** from the sidebar ICD list.
2. **Stripped from the generated text** via a regex replacement on each section: lines like `^- CODE Description$` whose code resolves to one not in the allowed set are deleted, then excess blank lines are collapsed.
3. **Logged at warning level** — `[generate] Defensive ICD filter — stripping N ungrounded code(s)...`.

With Pass 1.7 already in place this is belt-and-braces — it should rarely fire — but it's the last line of defense against LLM non-determinism leaking into the persisted note.

### 11.3 Title validation

The suggested title is sanity-checked (≤6 words, must mention the primary diagnosis). If Opus returns a title that violates the rules a short fallback is used.

### 11.4 Usage & audit logging

- `logUsage` ([web/src/lib/usage.ts](web/src/lib/usage.ts)) fire-and-forgets a row into `api_usage`. Cost is calculated from a model pricing map ([usage.ts:6-12](web/src/lib/usage.ts#L6)): Opus 4.6 $15/$75 per 1M tokens, Sonnet 4.6 $3/$15, Haiku 4.5 $1/$5. Operations logged: `generate_template`, `generate_template_draft`, `generate_template_refine`, `generate_title`, `reformat_template`, `clinical_analysis`, `fact_extraction`, `transcription`.
- `logAudit` / `createAuditContext` ([web/src/lib/audit.ts](web/src/lib/audit.ts)) writes to `audit_logs` for `encounter.generate`, `encounter.regenerate`, `encounter.edit`, `encounter.delete` with user ID, IP, and user agent.

### 11.5 Persistence

File: [web/src/app/api/generate/route.ts](web/src/app/api/generate/route.ts) — save block around line 649.

Fields written back to `visits`:

```
encounter_note           (HTML)
patient_letter           (HTML)
title                    (if not already titled)
status                   = "to_review"
metadata.template_id
metadata.doctor_notes
metadata.clinical_analysis   (specialty + filtered ICDs + medications)
metadata.generation_fingerprint
metadata.generation_history  (rolling last 10 runs)
```

The save goes through `retrySupabaseCall` from [web/src/lib/supabase/retry.ts](web/src/lib/supabase/retry.ts) — long Opus runs keep a Supabase keepalive connection idle past the Cloudflare 100s edge timeout, and the retry helper re-runs transient fetch failures.

---

## 12. Review & Regenerate

### 12.1 Review UI

[web/src/app/[locale]/(app)/encounters/[visitId]/page.tsx](<web/src/app/[locale]/(app)/encounters/[visitId]/page.tsx>) renders the note, letter, and metadata. Doctors can:

- Edit sections inline (see [use-section-editing.ts](web/src/components/encounters/hooks/use-section-editing.ts)).
- Edit metadata (title, template, language).
- Regenerate the note entirely.
- Finalize (status → `"finalized"`).
- Export to PDF or dispatch via email ([send-note-email.ts](web/src/lib/email/send-note-email.ts)).

### 12.2 Regenerate — two paths

File: [web/src/app/api/regenerate/route.ts](web/src/app/api/regenerate/route.ts)

1. **Fast reformat path** — triggered when the only change is a new template selection. Uses Haiku to reformat the existing note into the new template layout while preserving content. Doesn't re-run Pass 1 / Pass 1.5. Much cheaper.
2. **Full path** — used when content has changed, or no prior note exists. Identical pipeline to `/api/generate`:
   - Optionally reuses cached `clinical_analysis` from `visits.metadata` to skip Pass 1.
   - Still always runs Pass 1.5 (fact extraction), Pass 1.6 (validation + resolution), **Pass 1.7 (certainty filter)**, Pass 2, Pass 2.5.
   - Fingerprint is compared against the previous fingerprint to detect drift; `generation_history` is extended with the new run.

### 12.3 Determinism audit

`diffFingerprints(prev, next)` in [fingerprint.ts](web/src/lib/clinical/fingerprint.ts) tells us _which component_ changed. If only the composite hash changes while every component hash matches, the drift is LLM sampling variance. If a component hash changes, it's a bug somewhere in the pipeline and we know exactly where to look.

---

## 13. Supporting Infrastructure

| Concern            | Location                                                                   | Notes                                                                                                 |
| ------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Logger             | [web/src/lib/logger.ts](web/src/lib/logger.ts)                             | Levels: debug, info, warn, error. Prefixes like `[generate]`, `[fact-extraction]`, `[icd-certainty]`. |
| SSE helpers        | [web/src/lib/api/sse.ts](web/src/lib/api/sse.ts)                           | `createSSEStream`, `sseResponse`, `extractSectionsFromStream`.                                        |
| Supabase retry     | [web/src/lib/supabase/retry.ts](web/src/lib/supabase/retry.ts)             | Wraps writes that might hit Cloudflare idle timeout.                                                  |
| Audit log          | [web/src/lib/audit.ts](web/src/lib/audit.ts)                               | `logAudit`, `createAuditContext`. Writes to `audit_logs`.                                             |
| Fingerprint        | [web/src/lib/clinical/fingerprint.ts](web/src/lib/clinical/fingerprint.ts) | SHA-256 stable-stringify of every pipeline component.                                                 |
| JSON repair        | [web/src/lib/clinical/json-repair.ts](web/src/lib/clinical/json-repair.ts) | `extractJson` — tolerant parser with heuristics for code fences, trailing commas, truncation.         |
| Chunking           | [web/src/lib/chunking.ts](web/src/lib/chunking.ts)                         | Transcript chunker for embeddings.                                                                    |
| Platform detection | [web/src/lib/platform.ts](web/src/lib/platform.ts)                         | `isNative`, `isIOS`, `isAndroid`, `isWeb`.                                                            |
| Native guards      | [web/src/lib/native-guards.ts](web/src/lib/native-guards.ts)               | Start/stop foreground service for background mic.                                                     |

---

## 14. Data Model

### 14.1 Tables

| Table               | Migrations                                                                                                                                                               | Purpose                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `visits`            | [002](web/supabase/migrations/002_visits_schema.sql), [003](web/supabase/migrations/003_encounter_statuses.sql), [009](web/supabase/migrations/009_rename_soap_note.sql) | Main encounter record. Metadata is JSONB.                                             |
| `transcript_chunks` | [002](web/supabase/migrations/002_visits_schema.sql)                                                                                                                     | Legacy chunk + embedding store. Still used for similarity search on older encounters. |
| `templates`         | [006](web/supabase/migrations/006_templates.sql)–[012](web/supabase/migrations/012_template_usage.sql)                                                                   | User-defined templates with i18n, style guide, usage tracking.                        |
| `api_usage`         | [005](web/supabase/migrations/005_api_usage.sql)                                                                                                                         | Per-call token/cost log.                                                              |
| `audit_logs`        | [013](web/supabase/migrations/013_audit_logs.sql), [014](web/supabase/migrations/014_auth_audit_trigger.sql)                                                             | User-action audit trail.                                                              |

### 14.2 Key `visits` columns

```
id                  uuid (PK)
user_id             uuid (FK auth.users)
title               text
language            text (sk | cs | en)
status              text (draft | to_review | finalized | archived)
raw_text            text     -- final transcript
encounter_note      text     -- HTML note
patient_letter      text     -- HTML letter
metadata            jsonb    -- see below
created_at          timestamptz
updated_at          timestamptz
```

**`metadata` JSONB shape:**

```jsonc
{
  "files": [ /* FileMetadata[] */ ],
  "template_id": "soap_v1",
  "doctor_notes": "...",
  "clinical_analysis": {
    "inferredSpecialty": "cardiology",
    "matchedConcepts": [...],
    "candidateIcdCodes": [...],    // post-Pass-1.7 filtered
    "mentionedMedications": [...]
  },
  "generation_fingerprint": "sha256:...",
  "generation_history": [
    {
      "timestamp": "2026-04-09T...",
      "fingerprint": { "composite": "sha256:...", "components": {...} },
      "model": "claude-opus-4-6",
      "duration_ms": 42300
    }
  ]
}
```

### 14.3 Storage buckets

- `encounter-files` — uploaded images/PDFs/audio, RLS scoped to the owning user.

### 14.4 RPC / functions

- `match_chunks(query_embedding, match_count, p_visit_id)` — vector similarity search over `transcript_chunks`.
- Atomic file status update RPC from [20260401120753_atomic_file_status_update.sql](web/supabase/migrations/20260401120753_atomic_file_status_update.sql) to prevent duplicate extraction.

---

## 15. Tests

Everything in the clinical pipeline has unit tests in [web/src/lib/clinical/](web/src/lib/clinical/):

| File                                                                    | Coverage                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [fact-extraction.test.ts](web/src/lib/clinical/fact-extraction.test.ts) | Prompt building, `coerceFact` defensive parsing, empty-input short-circuit.                                                                                                                                                                                                                                           |
| [fact-validator.test.ts](web/src/lib/clinical/fact-validator.test.ts)   | `normalizeForMatch`, `evidenceAppearsInSource`, cross-source fallback, dedup, medication warnings.                                                                                                                                                                                                                    |
| [fact-resolver.test.ts](web/src/lib/clinical/fact-resolver.test.ts)     | Correction phrase detection (sk/cs/en), punctuation-bracketed negation regex, preservation of legitimate time-series.                                                                                                                                                                                                 |
| [icd-certainty.test.ts](web/src/lib/clinical/icd-certainty.test.ts)     | 27 tests including the user's EMS regression: candidates `[I21.2, I10, R07.2, E11.91, E78.5]` with diagnosis facts `["akútny infarkt myokardu", "artériová hypertenzia"]` → keeps exactly `[I21.2, I10]`. Also covers short-word whitelist, bidirectional stem matching, chapter strictness, determinism, and purity. |
| [icd-validation.test.ts](web/src/lib/clinical/icd-validation.test.ts)   | Canonical description replacement for hallucinated ICDs.                                                                                                                                                                                                                                                              |
| [json-repair.test.ts](web/src/lib/clinical/json-repair.test.ts)         | `extractJson` robust fallback parsing.                                                                                                                                                                                                                                                                                |
| [pipeline.test.ts](web/src/lib/clinical/pipeline.test.ts)               | `buildEnrichedSystemPrompt` — specialty, ICD, concepts, medications blocks.                                                                                                                                                                                                                                           |
| [fingerprint.test.ts](web/src/lib/clinical/fingerprint.test.ts)         | SHA-256 stability, stable stringify, `diffFingerprints` component-level diff.                                                                                                                                                                                                                                         |

Plus route-level integration tests in:

- [web/src/app/api/generate/route.test.ts](web/src/app/api/generate/route.test.ts)
- [web/src/app/api/regenerate/route.test.ts](web/src/app/api/regenerate/route.test.ts)

Total test suite as of this writing: **566 tests, all passing.**

---

## 16. Current Model Map

| Pass                       | Model ID                                                                                                     | Role                                | Why                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------ |
| File OCR (image / PDF)     | `claude-sonnet-4-6` (`max_tokens: 8192`, `temperature: 0`)                                                   | Image + PDF → text                  | Deterministic, same quality tier as the clinical pass. |
| Pass 1 — Clinical analysis | `claude-sonnet-4-6`                                                                                          | Concepts, specialty, ICDs, clusters | Haiku couldn't distinguish anatomically-specific ICDs. |
| Pass 1.5 — Fact extraction | `claude-haiku-4-5-20251001`                                                                                  | Grounded facts with evidence        | Cheap + fast + good enough at strict-rules JSON.       |
| Pass 2 — Generation        | `claude-opus-4-6` (fallbacks: `claude-sonnet-4-6`, `claude-sonnet-4-5-20250929`, `claude-sonnet-4-20250514`) | Prose note + letter + title         | Opus handles multi-section structured generation best. |
| Reformat (regen fast path) | `claude-haiku-4-5-20251001`                                                                                  | Template swap                       | Pure reformat, no clinical reasoning.                  |
| Transcription              | `scribe_v2` (ElevenLabs)                                                                                     | Audio → text                        | Better SK/CS than Whisper.                             |

All Anthropic calls use `temperature: 0`. None of the determinism guarantees come from temperature alone — the deterministic gates (Pass 1.6, 1.7, 2.5) are what actually stabilize the output.

---

## 17. Known Non-Determinism Sources & How We Absorb Them

| Source                                                                         | Absorbed by                                                                                       |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Pass 1 concept count drifting run-to-run (9 vs 7)                              | Downstream passes don't consume `matchedConcepts` as ground truth — only as hints.                |
| Pass 1 ICD candidates including weak inferences from labs/symptoms             | **Pass 1.7** drops anything not grounded in `diagnoses`/`history`.                                |
| Pass 1.5 Haiku occasionally mislabeling `transcript` vs `file` source type     | Pass 1.6 cross-source fallback.                                                                   |
| Pass 1.5 Haiku paraphrasing the evidence slightly                              | Fuzzy matcher in `evidenceAppearsInSource`.                                                       |
| Pass 1.5 Haiku emitting both sides of a correction                             | Pass 1.6b correction-phrase detector.                                                             |
| Opus ignoring the "only these ICDs" constraint                                 | **Pass 2.5** defensive filter strips the offending codes from both the sidebar and the note text. |
| Cloudflare 100s edge timeout killing idle Supabase writes after long Opus runs | `retrySupabaseCall` wrapper.                                                                      |
| File extraction failing transiently                                            | Errors collected into `extractionErrors` and surfaced; generation continues.                      |

---

## 18. Where to Make Changes

| Want to...                                         | Touch this                                                                                                                                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change what Pass 1 extracts                        | [prompts.ts](web/src/lib/clinical/prompts.ts) and [pipeline.ts:46](web/src/lib/clinical/pipeline.ts#L46)                                                                                                  |
| Change what counts as a fact or add a new category | [fact-extraction.ts](web/src/lib/clinical/fact-extraction.ts) (update `FactCategory`, prompt, and callers)                                                                                                |
| Change how facts are validated                     | [fact-validator.ts](web/src/lib/clinical/fact-validator.ts)                                                                                                                                               |
| Change how self-corrections are detected           | [fact-resolver.ts](web/src/lib/clinical/fact-resolver.ts) (add phrases to `CORRECTION_PHRASES`; tests ride alongside)                                                                                     |
| Change how ICD certainty is decided                | [icd-certainty.ts](web/src/lib/clinical/icd-certainty.ts) (+ tests)                                                                                                                                       |
| Change the Opus system prompt structure            | [anthropic.ts](web/src/lib/anthropic.ts) `buildTemplateSystemPrompt` + [pipeline.ts:123](web/src/lib/clinical/pipeline.ts#L123) `buildEnrichedSystemPrompt`                                               |
| Change the Opus user message layout                | [anthropic.ts](web/src/lib/anthropic.ts) `buildTemplateUserMessage`                                                                                                                                       |
| Wire in a new pipeline stage                       | Both [generate/route.ts](web/src/app/api/generate/route.ts) and [regenerate/route.ts](web/src/app/api/regenerate/route.ts) — don't forget the regenerate full path                                        |
| Add a new template                                 | [default-templates.ts](web/src/lib/templates/default-templates.ts) (built-in) or the admin UI (user-defined)                                                                                              |
| Add a specialty prompt pack                        | [specialty-prompts.ts](web/src/lib/clinical/specialty-prompts.ts)                                                                                                                                         |
| Add a clinical concept or ICD hint                 | [clinical-concepts.ts](web/src/lib/clinical/clinical-concepts.ts) and refresh any fixtures in tests                                                                                                       |
| Add a medication to the approved list              | [medication-index.ts](web/src/lib/clinical/medication-index.ts)                                                                                                                                           |
| Change the streaming protocol                      | [sse.ts](web/src/lib/api/sse.ts) _and_ the client consumer (`use-encounter-generation.ts`)                                                                                                                |
| Bump a model ID                                    | [pipeline.ts](web/src/lib/clinical/pipeline.ts), [fact-extraction.ts](web/src/lib/clinical/fact-extraction.ts), [anthropic.ts](web/src/lib/anthropic.ts), and pricing in [usage.ts](web/src/lib/usage.ts) |

Whenever you change a stage, also:

1. **Write or update tests.** Every clinical module has a matching `*.test.ts`.
2. **Update this document.** If the shape of the pipeline changes, the diagram in §0 and the pass descriptions above must follow.
3. **Run the full gates:** `npm run lint`, `npx prettier --write` on touched files, `npm run --prefix web test`, `npm run --prefix web build`.

---

## 19. Open Areas to Refine

Captured here so we don't lose the thread between sessions:

1. **Pass 1 caching.** We already reuse `metadata.clinical_analysis` on regenerate when content hasn't changed. We could go further: content-address the Pass 1 result by input hash so repeat generates never call Sonnet at all.
2. **Pass 1.5 truncation safety.** Haiku max_tokens is 16384; we've hit near the limit on very long encounters with many files. Consider sharding by source group or falling back to Sonnet on overflow.
3. **Fact-to-section alignment.** Right now Opus decides which facts land in which section. We could pre-assign facts to sections deterministically (e.g. `diagnoses` → Assessment, `plan` → Plan) and just let Opus phrase them.
4. **ICD certainty stem length.** 6 is a compromise. It correctly matches `hypert*` but has false-positive potential for short Slavic roots. Test suite covers the known cases; watch production logs for unexpected drops.
5. **Regenerate fast path.** Only reformat. If the doctor changes `doctor_notes` _and_ the template, we currently take the full path. Could be smarter.
6. **Embedding search.** `transcript_chunks` embeddings are still used for older encounters. Newer encounters store full `raw_text` and skip embeddings. Decide whether to deprecate chunking entirely.
7. **Telemetry dashboard.** `api_usage` + `generation_history` have the data but there's no internal dashboard yet. Would surface drift and cost per encounter.
8. **Title generator stability.** Title is generated alongside the note. It occasionally drifts between runs even when the note doesn't — add a deterministic rule-based title generator with Opus as fallback.

---

_This document is checked into the repo at [kb/note-generation-engine.md](kb/note-generation-engine.md). Keep it honest. If something here disagrees with the code, the code wins — and then update the doc._
