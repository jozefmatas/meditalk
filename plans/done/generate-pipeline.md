# MediTalk Generation Pipeline Optimization Plan

## Executive Summary

**Original baseline:** 117 seconds (file extraction: 51s, generation: 57s)

**Status:** Phase 1 complete ✅ - Real-time transcript usage + background extraction + caching implemented

**Next priority:** Phase 2 (two-pass generation)

---

## 📋 Quick Reference: What's Done vs What's Next

| Phase       | Item                             | Status  | Impact            | Effort       |
| ----------- | -------------------------------- | ------- | ----------------- | ------------ |
| **Phase 1** | Language parameter               | ✅ DONE | Accuracy          | Complete     |
| **Phase 1** | transcriptText bug fix           | ✅ DONE | Critical          | Complete     |
| **Phase 1** | Real-time transcript usage       | ✅ DONE | 40-50s            | Complete     |
| **Phase 1** | Background file extraction       | ✅ DONE | 15-50s/file       | Complete     |
| **Phase 1** | Cache file extractions           | ✅ DONE | 51s regenerate    | Complete     |
| **Phase 2** | Two-pass generation (Haiku+Opus) | ⏳ TODO | 25-30s            | 2-3 days     |
| **Phase 3** | Early clinical analysis          | ⏳ TODO | 5-10s             | 0.5 day      |
| **Phase 3** | Cache clinical analysis          | ⏳ TODO | 20-30s regenerate | 0.5 day      |
| **Phase 4** | Voice anonymization              | ✅ DONE | Privacy           | Disabled     |
| **Phase 4** | Remove WAV conversion            | ⏳ TODO | Upload speed      | Low priority |
| **Phase 4** | Audio optimization (ffmpeg)      | ⏳ TODO | 15-20s/file       | Low priority |

**Next Action:** Phase 2 (two-pass generation with Haiku + Opus) for 25-30s additional savings

---

## ✅ Completed Optimizations

### 1. Language Parameter for Transcription

- **Status:** ✅ DONE
- **Implementation:** Added `languageCode` parameter to ElevenLabs Scribe (Slovak/Czech/English)
- **Files:** `web/src/lib/elevenlabs.ts`, `web/src/lib/file-extraction.ts`, `web/src/app/api/generate/route.ts`
- **Impact:** Improved transcription accuracy for non-English medical terms

### 2. Real-time Transcript Bug Fix

- **Status:** ✅ DONE (CRITICAL)
- **Problem:** `transcriptText` wasn't being passed to Claude generation, causing empty or incomplete notes
- **Fix:** Pass real-time transcript to generation pipeline via `transcriptChunks`
- **Files:** `web/src/app/api/generate/route.ts`
- **Impact:** Production bug fixed - notes now include conversation transcript

### 3. Voice Anonymization

- **Status:** ✅ DONE (currently disabled in production)
- **Implementation:** Server-side ffmpeg with pitch shifting (±3 semitones) + formant preservation
- **Files:** `web/src/lib/server/audio-anonymization.ts`
- **Feature flag:** `ENABLE_AUDIO_ANONYMIZATION=false` (ready to enable)
- **Impact:** Privacy improvement - prevents patient identification via voice biometrics

### 4. WebSocket Error Suppression

- **Status:** ✅ DONE
- **Problem:** Code 1006 errors spammed console when pausing recording
- **Fix:** Suppress expected WebSocket closure errors
- **Files:** `web/src/components/encounters/recording-bar.tsx`
- **Impact:** Clean console logs during normal operation

---

## Context

Current generation pipeline still takes **~117 seconds** with major bottlenecks:

1. **File extraction: ~51 seconds** - transcribing audio files that were already transcribed in real-time
2. **Generation: ~57 seconds** - using Sonnet 4.5 for entire note (slow but high quality)

**Key insight:** Real-time Scribe transcript is available instantly but files may still be batch-transcribed unnecessarily in some cases.

## Current Pipeline Breakdown

```
User clicks "Generate" → 117 seconds total

├─ Auth (252ms) ✓ Fast
├─ File extraction (51s) ✗ CRITICAL BOTTLENECK
│  ├─ Recording.wav: Transcribe via ElevenLabs batch (~15s)
│  │  └─ But real-time transcript already available! WASTE!
│  ├─ 3x M4A files: Transcribe via ElevenLabs batch (~30-45s)
│  │  └─ Also wasteful if these are recordings
│  └─ 1x JPEG: OCR via Claude Vision (~5-10s)
├─ Clinical analysis (7s, parallel) ✓ Good
├─ Generation (57s) ⚠️ Can be faster
│  └─ Sonnet 4.5: 5375 input tokens, 2773 output tokens
└─ Email send (9s) ✓ Fine
```

## Optimization Strategy

### Phase 1: Quick Wins (50-60 seconds savings) ✅ COMPLETE

#### 1. ✅ Skip Audio Transcription When Real-time Transcript Available

**Status:** ✅ DONE (Real-time transcript properly used + audit logging)

**Problem:** Real-time transcript wasn't being used in generation pipeline

**Fix applied:**

- Real-time transcript now properly passed via `transcriptChunks` to Claude generation
- Language parameter added to improve transcription accuracy
- Voice anonymization implemented (disabled in production)

**Actual savings:** Variable (depends on file extraction optimizations)

**Remaining work:** Need to verify audio files are correctly skipping batch transcription when real-time transcript exists

#### 2. ✅ Background File Extraction on Upload (COMPLETE)

**Status:** ✅ DONE - Immediate background extraction implemented

**Solution:** All files trigger background extraction immediately on upload via new `/api/encounters/[encounterId]/extract` endpoint.

**Implementation:**

- Created new extract endpoint with status tracking ("extracting" | "completed" | "failed")
- Files-panel triggers extraction for ALL uploaded files immediately after upload
- Generate endpoint waits for in-progress extractions (500ms polling, 30s timeout)
- Real-time transcript still preferred for recording files during generation
- Race condition fixed with metadata re-reads before each save

**Files modified:**

- Created: [web/src/app/api/encounters/[encounterId]/extract/route.ts](web/src/app/api/encounters/[encounterId]/extract/route.ts)
- Modified: [web/src/components/encounters/files-panel.tsx](web/src/components/encounters/files-panel.tsx)
- Modified: [web/src/app/[locale]/(app)/encounters/[visitId]/page.tsx](<web/src/app/[locale]/(app)/encounters/[visitId]/page.tsx>)

**Actual savings:** 15-50 seconds per file (extraction happens during upload, not generation)

#### 3. ✅ Cache File Extractions in Metadata (COMPLETE)

**Status:** ✅ DONE - Full caching with extraction status tracking

**Solution:** Extract endpoint saves extracted_text and extraction_status to metadata. Generate endpoint skips files that already have extracted_text.

**Implementation:**

- Extract endpoint saves extracted_text + extraction_status to visit metadata
- Generate endpoint filters unprocessed files: `!f.extracted_text && f.extraction_status !== "extracting"`
- Failed extractions (empty text) marked as "failed" and retried
- Metadata re-read after extraction to preserve cached text in final save

**Files modified:**

- [web/src/app/api/encounters/[encounterId]/extract/route.ts](web/src/app/api/encounters/[encounterId]/extract/route.ts) - Lines 193-230
- [web/src/app/api/generate/route.ts](web/src/app/api/generate/route.ts) - Lines 168-172, 498-506

**Actual savings:** 51 seconds on regenerate (all file extraction skipped)

---

### Phase 2: Fast Model First, Opus Refinement (20-30 seconds savings) ⏳ NOT STARTED

#### 4. ⏳ Two-Pass Generation Strategy (NOT STARTED)

**Status:** ⏳ TODO - Medium priority (significant speed improvement)

**Approach:** Use Haiku for fast draft, then Opus 4.6 for refinement

**Current:** One pass with Sonnet 4.5 (57s)

**New:**

```
Pass 1 (Haiku): Generate full note structure + content (~15-20s)
  ↓
Pass 2 (Opus 4.6 / Sonnet 4.6): Refine medical accuracy + add details (~10-15s)
  ↓
Total: ~30s (vs 57s)
Savings: ~27s
```

**Implementation:**

```typescript
// Pass 1: Fast draft with Haiku
const draftResponse = await anthropic.messages.create({
  model: "claude-haiku-4-5-20251001",
  max_tokens: 4096, // Smaller for speed
  system: `${systemPrompt}\n\nGenerate a DRAFT encounter note. Focus on structure and key content. Will be refined in second pass.`,
  messages: [...],
  stream: true
});

// Extract draft content
const draftNote = extractNote(draftResponse);

// Pass 2: Refinement with fallback chain (Opus 4.6 → Sonnet 4.6 → Sonnet 4.5)
const refinedResponse = await anthropic.messages.create({
  model: "claude-opus-4-6", // Falls back to claude-sonnet-4-6 if overloaded
  max_tokens: 3072,
  system: `${systemPrompt}\n\nRefine this draft note for medical accuracy, completeness, and professional language.`,
  messages: [
    { role: "user", content: `Draft note:\n\n${draftNote}\n\nOriginal context:\n${originalContext}` }
  ],
  stream: true
});
```

**Why this works:**

- Haiku is 3-5x faster than Sonnet for draft
- Opus 4.6 is best at medical accuracy
- Sonnet 4.6 provides good quality fallback when Opus is overloaded
- Two smaller generations faster than one large generation
- User sees draft quickly, refinement streams in

**Expected savings:** 25-30 seconds

#### 5. Parallel Section Generation (Alternative Approach)

**Alternative:** Generate sections in parallel using Haiku, then combine

```typescript
const sections = ["chief_complaint", "history", "examination", "assessment", "plan"];

const sectionPromises = sections.map(section =>
  anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: `Generate ONLY the ${section} section`,
    messages: [...]
  })
);

const sectionResults = await Promise.all(sectionPromises);
// Combine sections
```

**Pros:** Faster (parallel processing)
**Cons:** Less context between sections, harder to maintain coherence

**Decision:** Use two-pass approach (simpler, better quality)

**Effort:** Medium (1-2 days)

---

### Phase 3: Clinical Analysis Optimization (5-10 seconds savings) ⏳ NOT STARTED

#### 6. ⏳ Run Clinical Analysis on Transcript Only (Don't Wait for Files) (NOT STARTED)

**Status:** ⏳ TODO - Medium priority

**Problem:** Clinical analysis waits for file extraction (51s) before running

**Current:** Lines 347-373 run clinical analysis AFTER file extraction completes

**Fix:** Run clinical analysis on transcript + doctor notes immediately, don't wait for files

```typescript
// NEW: Start clinical analysis early
const earlyInputs = [
  transcriptText ? { type: "text" as const, text: transcriptText } : null,
  doctorNotes ? { type: "text" as const, text: doctorNotes } : null,
].filter(Boolean);

// Start early clinical analysis (don't wait for files)
const clinicalPromise = earlyInputs.length > 0
  ? runClinicalAnalysis(earlyInputs, language, { userId, visitId })
  : Promise.resolve(null);

// File extraction continues in parallel
const filesPromise = extractFiles(...);

// Wait for both
const [clinicalAnalysis, extractedFiles] = await Promise.all([
  clinicalPromise,
  filesPromise
]);
```

**Expected savings:** 5-10 seconds (clinical analysis overlaps with file extraction)

**Effort:** Low (1 day)

#### 7. ⏳ Cache Clinical Analysis Results (NOT STARTED)

**Status:** ⏳ TODO - High priority for regenerate performance

**Problem:** Every regenerate re-runs clinical analysis (20-30s wasted)

**Fix:** Store clinical analysis in visit metadata, skip if content unchanged

```typescript
// Check if clinical analysis already exists and content unchanged
const existingAnalysis = visit.metadata?.clinical_analysis;
const contentHash = crypto.createHash('sha256')
  .update(transcriptText + doctorNotes)
  .digest('hex');

let clinicalAnalysis;
if (existingAnalysis && existingAnalysis.contentHash === contentHash) {
  clinicalAnalysis = existingAnalysis.result;
  console.log('[generate] Using cached clinical analysis');
} else {
  clinicalAnalysis = await runClinicalAnalysis(...);
  // Save to metadata
  await supabase.from("visits").update({
    metadata: {
      ...visit.metadata,
      clinical_analysis: {
        contentHash,
        result: clinicalAnalysis,
        timestamp: Date.now()
      }
    }
  }).eq("id", visitId);
}
```

**Expected savings:** 20-30 seconds on regenerate

**Effort:** Low (1 day)

---

### Phase 4: Audio Optimization for Faster Transcription ⚠️ PARTIALLY COMPLETE

**Insight:** Small, clean audio files transcribe MUCH faster than large, noisy files

**Note:** Voice anonymization (item 10) is complete but disabled in production

#### 8. ⏳ Remove WAV Conversion, Upload WebM/Opus Directly (NOT STARTED)

**Status:** ⏳ TODO - Medium priority (faster uploads)

**Problem:** Converting to WAV creates 10x larger files (slow upload on slow internet)

**Fix:** Upload WebM/Opus directly (already supported by ElevenLabs)

**Expected savings:** 8-10x faster upload on slow connections

**Effort:** Low (remove existing WAV conversion code)

#### 9. ⏳ Pre-process Uploaded Audio Files with ffmpeg (NOT STARTED)

**Status:** ⏳ TODO - Low priority (nice to have)

**Problem:** User-uploaded audio files (M4A, MP3, etc.) may be large, noisy, or poorly encoded

**Approach:** Server-side ffmpeg optimization BEFORE sending to ElevenLabs:

```bash
# Optimize uploaded audio for fast transcription
ffmpeg -i input.m4a \
  -af "highpass=f=100,lowpass=f=8000,dynaudnorm" \
  -c:a libopus -b:a 32k -ar 16000 -ac 1 \
  output.opus
```

**Benefits:**

- **Smaller files:** 32kbps Opus vs 128-256kbps M4A = 4-8x smaller
- **Faster upload to ElevenLabs:** Smaller file = faster API call
- **Cleaner audio:** Noise reduction = faster processing by Scribe
- **Faster transcription:** Optimized audio processes quicker

**Expected speedup:**

- Large M4A (5MB, 10min): ~30s transcription
- Optimized Opus (600KB, 10min): ~10-15s transcription
- **Savings:** 15-20s per uploaded audio file

**Implementation:**

```typescript
// In generate/route.ts, before transcription
if (file.type.startsWith("audio/") && file.type !== "audio/opus") {
  console.log(`[generate] Optimizing ${file.name} for fast transcription`);

  // Download original
  const originalBuffer = await downloadFile(file.path);

  // Optimize with ffmpeg
  const optimizedBuffer = await optimizeAudioForTranscription(
    originalBuffer,
    file.type,
  );

  // Transcribe optimized version (faster!)
  const text = await transcribeAudio(optimizedBuffer, "audio/opus", language, {
    userId,
    visitId,
  });

  // Note: Keep original file in storage, just transcribe the optimized version
  file.extracted_text = text;
}
```

**Function to add:**

```typescript
// admin/lib/audio-optimization.ts (NEW)
export async function optimizeAudioForTranscription(
  inputBuffer: Buffer,
  inputMimeType: string,
): Promise<Buffer> {
  const tempInput = `/tmp/${crypto.randomUUID()}.${getExtension(inputMimeType)}`;
  const tempOutput = `/tmp/${crypto.randomUUID()}.opus`;

  await fs.writeFile(tempInput, inputBuffer);

  // Optimize for transcription: small, clean, mono, 16kHz
  const ffmpegCommand = `ffmpeg -i "${tempInput}" \
    -af "highpass=f=100,lowpass=f=8000,dynaudnorm" \
    -c:a libopus -b:a 32k -ar 16000 -ac 1 \
    "${tempOutput}"`;

  await execAsync(ffmpegCommand, { timeout: 60000 });

  const optimizedBuffer = await fs.readFile(tempOutput);

  // Cleanup
  await Promise.all([fs.unlink(tempInput), fs.unlink(tempOutput)]);

  return optimizedBuffer;
}
```

**Expected savings:** 15-20 seconds per uploaded audio file + faster transcription

**Effort:** Medium (2-3 days, ffmpeg setup required)

#### 10. ✅ Voice Anonymization (COMPLETE - Disabled in Production)

**Status:** ✅ DONE - Implementation complete, feature flag disabled

**Implementation:** Server-side ffmpeg with pitch shifting (±3 semitones) + formant preservation

**Files:** `web/src/lib/server/audio-anonymization.ts`, `web/src/app/api/generate/route.ts`

**Feature flag:** `ENABLE_AUDIO_ANONYMIZATION=false` (can enable when ready)

**Details:** See [cryptic-baking-thunder.md](../.claude/plans/cryptic-baking-thunder.md) for full implementation

**Expected impact:** Privacy improvement (prevents voice biometric identification), minimal speed impact

**Next step:** Enable in production after testing

---

## Expected Performance Improvements

### Timeline Comparison

**Current:**

```
0s ────────────────────────────────────────────────── 117s
   │
   ├─ [0-51s] File extraction (blocking)
   ├─ [51-58s] Clinical analysis
   ├─ [58-115s] Generation (Sonnet 4.5)
   └─ [115-117s] Email
```

**Optimized:**

```
0s ──────────────────────────────────── 35s (70% faster!)
   │
   ├─ [0-5s] Skip file extraction (use real-time transcript!)
   ├─ [0-7s] Clinical analysis (parallel, early start)
   ├─ [5-25s] Pass 1: Haiku draft
   ├─ [25-35s] Pass 2: Opus refinement
   └─ [35-37s] Email
```

### Savings Breakdown

| Optimization                             | Time Saved             | Status        | Effort             |
| ---------------------------------------- | ---------------------- | ------------- | ------------------ |
| Skip audio transcription (use real-time) | 40-50s                 | ⚠️ Partial    | Low (verify logic) |
| Mark uploaded files with source          | 30-45s per file        | ⏳ TODO       | Low (1-2 hours)    |
| Cache file extractions                   | 51s (on regenerate)    | ⏳ TODO       | Low (2-3 hours)    |
| Two-pass generation (Haiku + Opus)       | 25-30s                 | ⏳ TODO       | Medium (2-3 days)  |
| Early clinical analysis                  | 5-10s                  | ⏳ TODO       | Low (1 day)        |
| Cache clinical analysis                  | 20-30s (on regenerate) | ⏳ TODO       | Low (1 day)        |
| Remove WAV conversion                    | 8x faster upload       | ⏳ TODO       | Low (remove code)  |
| Optimize uploaded audio with ffmpeg      | 15-20s per file        | ⏳ TODO       | Medium (2-3 days)  |
| Voice anonymization                      | Privacy win            | ✅ DONE       | (disabled)         |
| Language parameter                       | Accuracy win           | ✅ DONE       | Complete           |
| transcriptText bug fix                   | Critical fix           | ✅ DONE       | Complete           |
| **TOTAL POTENTIAL SAVINGS (FIRST RUN)**  | **85-110s**            | **~1 week**   | **3-4 days work**  |
| **TOTAL POTENTIAL SAVINGS (REGENERATE)** | **90-110s**            | **Same code** | **Same work**      |

### Performance Targets

| Metric                       | Current | Target     | Improvement    |
| ---------------------------- | ------- | ---------- | -------------- |
| First generation             | 117s    | **35-40s** | **70% faster** |
| Regeneration                 | 117s    | **10-15s** | **90% faster** |
| File extraction              | 51s     | **<5s**    | **10x faster** |
| Generation                   | 57s     | **25-30s** | **50% faster** |
| Upload (10min audio, 5 Mbps) | 30s     | **3s**     | **10x faster** |

## 🎯 Current Status & Immediate Next Steps

### Priority 1: Complete Phase 1 (File Extraction - HIGH IMPACT) ⚠️

**Estimated time:** 1-2 days
**Expected savings:** 40-50 seconds per generation, 51s on regenerate

**Tasks:**

1. ⏳ Verify real-time transcript is skipping batch transcription (Item #1)
   - Check generate/route.ts logic for audio file handling
   - Add audit logging for skipped extractions
   - Test: ensure recording audio doesn't get re-transcribed

2. ⏳ Mark uploaded files with recording source (Item #2)
   - Modify use-encounter-generation.ts to tag files with `source: "recording-upload"`
   - Enable these files to use real-time transcript too

3. ⏳ Cache file extractions in metadata (Item #3)
   - Save extracted_text to visit.metadata.files after extraction
   - Skip extraction if extracted_text already exists
   - HUGE savings on regenerate (51 seconds → <1 second)

### Priority 2: Two-Pass Generation (Phase 2 - MEDIUM IMPACT) ⏳

**Estimated time:** 2-3 days
**Expected savings:** 25-30 seconds per generation

**Tasks:**

1. Implement Haiku draft pass (fast structure generation)
2. Implement Opus 4.6 refinement pass (medical accuracy)
3. Add feature flag `ENABLE_TWO_PASS_GENERATION`
4. Test quality vs current Sonnet single-pass

### Priority 3: Clinical Analysis Optimization (Phase 3 - LOW IMPACT) ⏳

**Estimated time:** 1-2 days
**Expected savings:** 5-10 seconds first run, 20-30s on regenerate

**Tasks:**

1. Run clinical analysis early (parallel with file extraction)
2. Cache clinical analysis results with content hash

---

## Implementation Plan (Consolidated)

### ✅ COMPLETED: Language & Transcript Fixes

**What was done:**

- Added language parameter to ElevenLabs Scribe (Slovak/Czech/English)
- Fixed transcriptText not being passed to Claude (production bug)
- Implemented voice anonymization (disabled in production)
- Suppressed expected WebSocket 1006 errors

**Files modified:**

- `web/src/lib/elevenlabs.ts`
- `web/src/lib/file-extraction.ts`
- `web/src/app/api/generate/route.ts`
- `web/src/lib/server/audio-anonymization.ts`
- `web/src/components/encounters/recording-bar.tsx`

---

### ⏳ NEXT: Complete Phase 1 (File Extraction Optimization)

**Files to modify:**

1. [web/src/app/api/generate/route.ts](web/src/app/api/generate/route.ts)
   - Verify real-time transcript logic for ALL audio files
   - Save extracted_text back to metadata for caching
   - Add audit logging for skipped extractions

2. [web/src/components/encounters/hooks/use-encounter-generation.ts](web/src/components/encounters/hooks/use-encounter-generation.ts)
   - Mark uploaded files with `source: "recording-upload"`

**Testing:**

- Record audio, generate note → verify no batch transcription
- Upload audio during recording → verify uses real-time transcript
- Check logs: "file.extraction.skipped" events
- Regenerate same visit → verify cached extraction used (51s savings!)
- Measure: File extraction should be <5s first run, <1s regenerate

---

### ⏳ FUTURE: Phase 2 - Two-Pass Generation

**Files to modify:**

1. [web/src/app/api/generate/route.ts](web/src/app/api/generate/route.ts)
   - Lines 418-759: Refactor into two-pass approach
   - Pass 1: Haiku with max_tokens 4096
   - Pass 2: Opus 4.6 with max_tokens 3072
   - Stream both passes to client

**Environment variables:**

```env
# Enable two-pass generation
ENABLE_TWO_PASS_GENERATION=true

# Model configuration
DRAFT_MODEL=claude-haiku-4-5-20251001
REFINE_MODEL=claude-opus-4-6
```

**Testing:**

- Generate note, measure total time
- Compare quality: two-pass vs single-pass Sonnet
- Verify streaming works for both passes
- Target: <35s total generation time

### Day 5: Clinical Analysis Optimization

**Files to modify:**

1. [web/src/app/api/generate/route.ts](web/src/app/api/generate/route.ts)
   - Lines 347-373: Start clinical analysis early (don't wait for files)
   - Add caching with content hash
   - Save to visit metadata

**Testing:**

- First generation: verify clinical analysis runs in parallel
- Regenerate: verify cache hit, no re-analysis
- Measure: Clinical analysis should overlap with file extraction

### Day 6-7: Audio Optimization

**Files to create:**

1. `admin/lib/audio-optimization.ts` (NEW)
   - ffmpeg optimization function
   - File size reduction
   - Audio enhancement for transcription

**Files to modify:** 2. [web/src/app/api/generate/route.ts](web/src/app/api/generate/route.ts)

- Optimize uploaded audio before transcription
- Use optimized version for ElevenLabs API

**Testing:**

- Upload M4A file, verify ffmpeg optimization
- Measure transcription time improvement
- Verify audio quality sufficient for transcription

### Day 8: Voice Anonymization (Lower Priority)

**Files to modify:**

1. [web/src/components/encounters/hooks/use-encounter-generation.ts](web/src/components/encounters/hooks/use-encounter-generation.ts)
   - Remove WAV conversion
   - Upload WebM directly

2. `admin/lib/audio-anonymization.ts` (NEW)
   - Server-side ffmpeg processing
   - Pitch shift + formant preservation

**See:** [cryptic-baking-thunder.md](../.claude/plans/cryptic-baking-thunder.md) for full details

## Feature Flags

**File:** `.env.local` and production environment

```env
# Phase 1: File extraction optimization
SKIP_AUDIO_TRANSCRIPTION_WITH_REALTIME=true
CACHE_FILE_EXTRACTIONS=true

# Phase 2: Two-pass generation
ENABLE_TWO_PASS_GENERATION=true
DRAFT_MODEL=claude-haiku-4-5-20251001
REFINE_MODEL=claude-opus-4-6

# Phase 3: Clinical analysis optimization
ENABLE_EARLY_CLINICAL_ANALYSIS=true
CACHE_CLINICAL_ANALYSIS=true

# Phase 4: Audio optimization
ENABLE_AUDIO_OPTIMIZATION=true

# Phase 5: Voice anonymization (lower priority)
ENABLE_VOICE_ANONYMIZATION=false
```

## Verification & Testing

### Performance Testing

**Test 1: File Extraction Speed**

```bash
# Before optimization
time curl -X POST /api/generate -d '{"visitId": "...", "transcriptText": "...", ...}'
# Expected: ~51s for file extraction

# After optimization
time curl -X POST /api/generate -d '{"visitId": "...", "transcriptText": "...", ...}'
# Expected: <5s for file extraction
```

**Test 2: Generation Speed**

```bash
# Measure Haiku draft time
# Measure Opus refinement time
# Total should be <35s
```

**Test 3: Regeneration Speed**

```bash
# First generation: ~35-40s
# Second generation (cached): ~10-15s
```

### Quality Testing

**Test 1: Transcript Quality**

- Record audio with real-time Scribe
- Verify transcript accuracy is maintained
- Compare: real-time vs batch transcription

**Test 2: Note Quality**

- Generate with Haiku + Opus two-pass
- Compare to Sonnet single-pass
- Verify medical accuracy, completeness, formatting

**Test 3: Clinical Analysis**

- Verify specialty inference accuracy
- Check ICD code suggestions
- Ensure early analysis doesn't miss critical info

### Regression Testing

- [ ] File extraction still works for non-recording files (PDFs, images)
- [ ] Embedding search still works when no transcript available
- [ ] Error handling for failed extractions
- [ ] Streaming still works during generation
- [ ] Email sending still works
- [ ] Audit logs complete and accurate

## Monitoring & Rollback

### Metrics to Track

**Performance Metrics:**

- File extraction time (target: <5s)
- Generation time (target: <35s)
- Total generation time (target: <40s)
- Cache hit rate for file extractions (target: >80% on regenerate)
- Cache hit rate for clinical analysis (target: >90% on regenerate)

**Quality Metrics:**

- Note completeness (compare two-pass vs single-pass)
- Medical accuracy (specialist review)
- User satisfaction (faster = better UX)

**Error Metrics:**

- File extraction failures
- Generation failures (model errors)
- Cache corruption or misses

### Rollback Strategy

**If performance degrades:**

```env
# Disable optimizations one by one
SKIP_AUDIO_TRANSCRIPTION_WITH_REALTIME=false
ENABLE_TWO_PASS_GENERATION=false
ENABLE_EARLY_CLINICAL_ANALYSIS=false
ENABLE_AUDIO_OPTIMIZATION=false
```

**If quality degrades:**

- Switch back to Sonnet single-pass
- Disable caching
- Force re-extraction

## Cost Analysis

### Current Costs (per generation)

**ElevenLabs Scribe:**

- Real-time streaming: $0.40/hour (during recording)
- Batch transcription: $0.40/hour × 3 files = $1.20
- **Total:** $1.60 per generation

**Anthropic Claude:**

- Sonnet 4.5: 5375 input + 2773 output tokens
- Cost: ~$0.015 per generation

**Total:** ~$1.62 per generation

### Optimized Costs (per generation)

**ElevenLabs Scribe:**

- Real-time streaming: $0.40/hour (during recording)
- Batch transcription: **$0** (skipped!)
- **Total:** $0.40 per generation

**Anthropic Claude:**

- Haiku draft: 4000 input + 2000 output = ~$0.001
- Opus refinement: 3000 input + 1500 output = ~$0.020
- **Total:** ~$0.021 per generation

**Total:** ~$0.42 per generation

**Savings:** $1.20 per generation (74% cost reduction!)

## Critical Files Summary

The 5 most critical files for this implementation:

1. **[web/src/app/api/generate/route.ts](web/src/app/api/generate/route.ts)**
   - Main generation pipeline (ALL optimizations happen here)
   - Lines 130-145: Skip audio transcription logic
   - Lines 215-230: Cache file extractions
   - Lines 347-373: Early clinical analysis
   - Lines 418-759: Two-pass generation

2. **[web/src/components/encounters/hooks/use-encounter-generation.ts](web/src/components/encounters/hooks/use-encounter-generation.ts)**
   - Remove WAV conversion (lines 278-350)
   - Pass real-time transcript to API
   - Upload WebM directly

3. **[web/src/components/encounters/recording-bar.tsx](web/src/components/encounters/recording-bar.tsx)**
   - Ensure real-time transcript captured properly
   - Verify Scribe streaming works
   - Pass transcript to finalize()

4. **`admin/lib/audio-optimization.ts`** (NEW)
   - ffmpeg optimization for uploaded audio
   - Reduce file size for faster transcription
   - Audio enhancement (noise reduction, normalization)

5. **[web/src/lib/file-extraction.ts](web/src/lib/file-extraction.ts)**
   - Review extraction logic
   - Ensure caching doesn't break other file types
   - Add logging for optimization

## Timeline

**Original estimate:** 1 week full implementation

**Current progress:** ~20% complete (language, bug fixes, anonymization infrastructure)

**Remaining work:**

### High Priority (Next 2-3 days) - Phase 1 Complete

- **Days 1-2:** Complete file extraction optimization
  - Verify real-time transcript usage (0.5 day)
  - Mark uploaded files with source (0.5 day)
  - Cache file extractions in metadata (1 day)
  - **Expected savings:** 40-50s first run, 51s regenerate

### Medium Priority (Next 3-5 days) - Phase 2

- **Days 3-5:** Two-pass generation (Haiku + Opus)
  - Implement draft pass (1 day)
  - Implement refinement pass (1 day)
  - Testing and quality comparison (1 day)
  - **Expected savings:** 25-30s per generation

### Lower Priority (Next 2-3 days) - Phase 3

- **Days 6-7:** Clinical analysis optimization
  - Early parallel execution (0.5 day)
  - Caching with content hash (0.5 day)
  - **Expected savings:** 5-10s first run, 20-30s regenerate

### Optional (Future)

- Remove WAV conversion (Low priority - minor upload speed improvement)
- Audio optimization with ffmpeg (Low priority - only for uploaded files)

---

## Success Criteria

### ✅ Already Achieved

- ✅ Language parameter added (improved transcription accuracy)
- ✅ transcriptText bug fixed (critical production fix)
- ✅ Voice anonymization implemented (privacy win, disabled in production)
- ✅ WebSocket error suppression (clean console logs)

### 🎯 Phase 1 Target (Next 2-3 days)

- ⏳ File extraction: 51s → <5s (90% improvement)
- ⏳ Regeneration: 51s → <1s (98% improvement)
- ⏳ Cost: Save $1.20 per generation (skip batch transcription)

### 🎯 Phase 2 Target (Next 3-5 days)

- ⏳ Generation: 57s → 25-30s (50% improvement)
- ⏳ Quality: Maintain or improve with Opus refinement
- ⏳ Streaming: Both passes stream to client

### 🎯 Final Target (After all phases)

- ⏳ Total first generation: 117s → 35-40s (70% faster)
- ⏳ Total regeneration: 117s → 10-15s (90% faster)
- ⏳ Cost: $1.62 → $0.42 (74% reduction)

## References

- Current implementation: [web/src/app/api/generate/route.ts](web/src/app/api/generate/route.ts)
- ElevenLabs Scribe V2: https://elevenlabs.io/docs/api-reference/speech-to-text/convert
- Claude Haiku 4.5: https://docs.anthropic.com/claude/docs/models-overview#model-comparison
- Claude Opus 4.6: https://docs.anthropic.com/claude/docs/models-overview#claude-4-opus
- ffmpeg audio optimization: https://trac.ffmpeg.org/wiki/AudioChannelManipulation
