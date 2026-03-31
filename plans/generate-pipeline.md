# MediTalk Generation Pipeline Optimization Plan

## Context

Current generation pipeline takes **117 seconds** (almost 2 minutes!), with two major bottlenecks:
1. **File extraction: 51 seconds** - transcribing audio files that were already transcribed in real-time
2. **Generation: 57 seconds** - using Sonnet 4.5 for entire note (slow but high quality)

**Key insight:** Real-time Scribe transcript is available instantly (107 chars in logs) but the server still transcribes audio files via ElevenLabs batch API, wasting 40-50 seconds per generation.

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

### Phase 1: Quick Wins (50-60 seconds savings) - Days 1-2

#### 1. Skip Audio Transcription When Real-time Transcript Available

**Problem:** Lines 130-132 in [generate/route.ts](web/src/app/api/generate/route.ts) only use `transcriptText` for the FIRST recording file.

**Current code:**
```typescript
if (file.source === "recording" && transcriptText) {
  file.extracted_text = transcriptText;
  return; // ← Only works for ONE file!
}
// Otherwise: transcribe via ElevenLabs batch (SLOW!)
```

**Fix:**
```typescript
// NEW: Use real-time transcript for ALL audio from recording
if (transcriptText && file.source === "recording" && file.type.startsWith("audio/")) {
  file.extracted_text = transcriptText;
  logAudit({
    event: "file.extraction.skipped",
    userId,
    visitId,
    metadata: {
      reason: "realtime_transcript_available",
      file: file.name,
      savedTime: "~30-45s"
    }
  });
  return; // Skip batch transcription
}
```

**Expected savings:** 40-50 seconds (no batch transcription of recording audio)

#### 2. Mark Uploaded Files with Source

**Problem:** User-uploaded M4A files don't have `source: "recording"` so they always get transcribed even if they're from the same recording session.

**Fix:** When files are uploaded during a recording session, mark them with `source: "recording-upload"` so they can use the same real-time transcript.

**File:** [use-encounter-generation.ts](web/src/components/encounters/hooks/use-encounter-generation.ts)

```typescript
// In handleFileUpload or similar
await uploadWithPersistence(blob, filename, visitId, {
  source: isRecordingActive ? "recording-upload" : undefined,
  onProgress: ...
});
```

**Expected savings:** 30-45 seconds per uploaded audio file

#### 3. Cache File Extractions in Metadata

**Problem:** No caching - regenerating the same visit re-extracts all files

**Current:** Lines 112-114 filter `!f.extracted_text` but files don't persist extracted text

**Fix:** Save extracted text back to metadata after extraction

```typescript
// After extraction completes
await supabase
  .from("visits")
  .update({
    metadata: {
      ...visit.metadata,
      files: uploadedFiles // Now includes extracted_text
    }
  })
  .eq("id", visitId);
```

**Expected savings:** 51 seconds on regenerate (all file extraction skipped)

### Phase 2: Fast Model First, Opus Refinement (20-30 seconds savings) - Days 3-4

#### 4. Two-Pass Generation Strategy

**Approach:** Use Haiku for fast draft, then Opus 4.6 for refinement

**Current:** One pass with Sonnet 4.5 (57s)

**New:**
```
Pass 1 (Haiku): Generate full note structure + content (~15-20s)
  ↓
Pass 2 (Opus 4.6): Refine medical accuracy + add details (~10-15s)
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

// Pass 2: Refinement with Opus 4.6
const refinedResponse = await anthropic.messages.create({
  model: "claude-opus-4-6",
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
- Opus 4.6 is better at medical accuracy than Sonnet
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

### Phase 3: Clinical Analysis Optimization (5-10 seconds savings) - Day 5

#### 6. Run Clinical Analysis on Transcript Only (Don't Wait for Files)

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

#### 7. Cache Clinical Analysis Results

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

### Phase 4: Audio Optimization for Faster Transcription - Days 6-7

**Insight:** Small, clean audio files transcribe MUCH faster than large, noisy files

#### 8. Remove WAV Conversion, Upload WebM/Opus Directly

**Problem:** Converting to WAV creates 10x larger files (slow upload on slow internet)

**Fix:** Upload WebM/Opus directly (already supported by ElevenLabs)

**Expected savings:** 8-10x faster upload on slow connections

#### 9. Pre-process Uploaded Audio Files with ffmpeg

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
  const optimizedBuffer = await optimizeAudioForTranscription(originalBuffer, file.type);

  // Transcribe optimized version (faster!)
  const text = await transcribeAudio(optimizedBuffer, "audio/opus", language, { userId, visitId });

  // Note: Keep original file in storage, just transcribe the optimized version
  file.extracted_text = text;
}
```

**Function to add:**

```typescript
// admin/lib/audio-optimization.ts (NEW)
export async function optimizeAudioForTranscription(
  inputBuffer: Buffer,
  inputMimeType: string
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
  await Promise.all([
    fs.unlink(tempInput),
    fs.unlink(tempOutput)
  ]);

  return optimizedBuffer;
}
```

**Expected savings:** 15-20 seconds per uploaded audio file + faster transcription

#### 10. Voice Anonymization (Optional - Privacy)

**Approach:** After optimization, add pitch shift for privacy

**Implementation:** See [cryptic-baking-thunder.md](../.claude/plans/cryptic-baking-thunder.md) for details

**Expected impact:** Privacy improvement, minimal speed impact (done during optimization)

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

| Optimization | Time Saved | Effort |
|--------------|------------|--------|
| Skip audio transcription (use real-time) | 40-50s | Low (2 lines of code) |
| Optimize uploaded audio with ffmpeg | 15-20s per file | Medium (add ffmpeg) |
| Cache file extractions | 51s (on regenerate) | Low (metadata update) |
| Two-pass generation (Haiku + Opus) | 25-30s | Medium (refactor) |
| Early clinical analysis | 5-10s | Low (parallel start) |
| Cache clinical analysis | 20-30s (on regenerate) | Low (hash check) |
| Remove WAV conversion | 8x faster upload | Low (remove code) |
| **TOTAL FIRST RUN** | **85-110s** | **3-4 days** |
| **TOTAL REGENERATE** | **90-110s** | **Same code** |

### Performance Targets

| Metric | Current | Target | Improvement |
|--------|---------|--------|-------------|
| First generation | 117s | **35-40s** | **70% faster** |
| Regeneration | 117s | **10-15s** | **90% faster** |
| File extraction | 51s | **<5s** | **10x faster** |
| Generation | 57s | **25-30s** | **50% faster** |
| Upload (10min audio, 5 Mbps) | 30s | **3s** | **10x faster** |

## Implementation Plan

### Day 1-2: Quick Wins (File Extraction Optimization)

**Files to modify:**
1. [web/src/app/api/generate/route.ts](web/src/app/api/generate/route.ts)
   - Lines 130-145: Expand real-time transcript usage to ALL audio files
   - Lines 215-230: Save extracted_text back to metadata for caching
   - Add audit logging for skipped extractions

**Testing:**
- Record audio, generate note → verify no batch transcription
- Check logs: "file.extraction.skipped" events
- Regenerate same visit → verify cached extraction used
- Measure: File extraction should be <5s

### Day 3-4: Two-Pass Generation

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

**Files to modify:**
2. [web/src/app/api/generate/route.ts](web/src/app/api/generate/route.ts)
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

**Total estimated time:** 1 week

- **Days 1-2:** File extraction optimization (HUGE WIN: 70s savings)
- **Days 3-4:** Two-pass generation (25-30s savings)
- **Day 5:** Clinical analysis optimization (5-10s savings + regenerate speedup)
- **Days 6-7:** Audio optimization (15-20s per file)
- **Day 8:** Testing, monitoring, rollout

## Success Criteria

### Week 1 Target
- ✅ File extraction: 51s → <5s (90% improvement)
- ✅ Generation: 57s → <35s (40% improvement)
- ✅ Total: 117s → <40s (66% improvement)
- ✅ Cost: $1.62 → $0.42 (74% reduction)

### Week 2 Target (Regeneration)
- ✅ File extraction: <1s (cached)
- ✅ Clinical analysis: <1s (cached)
- ✅ Generation: <30s (two-pass)
- ✅ Total: <15s (87% improvement)

## References

- Current implementation: [web/src/app/api/generate/route.ts](web/src/app/api/generate/route.ts)
- ElevenLabs Scribe V2: https://elevenlabs.io/docs/api-reference/speech-to-text/convert
- Claude Haiku 4.5: https://docs.anthropic.com/claude/docs/models-overview#model-comparison
- Claude Opus 4.6: https://docs.anthropic.com/claude/docs/models-overview#claude-4-opus
- ffmpeg audio optimization: https://trac.ffmpeg.org/wiki/AudioChannelManipulation
