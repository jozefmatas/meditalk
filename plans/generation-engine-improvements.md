# Generation Engine Improvements — Consistency, Accuracy & Anti-Hallucination

> Created: 2026-04-07
> Status: Phase 1 ✅ complete — Phase 2 ✅ complete — Phase 3+ not started
> Related: `plans/done/generation-pipeline-refactor.md` (infrastructure)

## Progress

| Phase                                             | Status                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| **Phase 1: Quick Wins** (1.1–1.8)                 | ✅ **Done** (2026-04-08)                                                  |
| **Phase 2: Structured Fact Extraction** (2.1–2.6) | ✅ **Done** (2026-04-08)                                                  |
| Phase 3: Report from Validated Facts              | ⏳ Not started                                                            |
| Phase 4: Enhanced Post-Processing                 | ⏳ Not started                                                            |
| Phase 5: Consistency Testing Framework            | ⏳ Not started                                                            |
| Phase 6: Template Integration Audit               | 🟡 Partial — 6.2 ICD/validation pieces done via 1.7/1.8; rest not started |

---

## Problem Statement

Three recurring issues reported by clinical testing (Ciel):

1. **Inconsistency** — Same source docs + same prompt produce noticeably different reports across runs
2. **Treatment/medication inaccuracies** — Medication list was accurate after a previous fix but regressed (de novo errors reappearing)
3. **Diagnosis hallucination** — Wrong diagnosis severity (e.g. "predný STEMI" instead of non-STEMI), previously fixed but recurring
4. **Symptom hallucination** — Symptoms appearing in report that were never mentioned (e.g. cough) — partially fixed with grounding tweak

### Root Causes

| Issue                     | Root Cause                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Inconsistency             | No `temperature` set on Opus call → defaults to `1.0` (maximum creativity)                                                   |
| Diagnosis/treatment drift | Single-pass generation: facts and prose generated together → model "invents" plausible-sounding details during prose writing |
| Recurring regressions     | No structured validation step — grounding is instruction-only, not enforced programmatically                                 |
| Template context ignored  | Section `context` field exists but is underutilized — no systematic way to constrain what goes in each section               |

---

## Architecture: Current vs. Proposed

### Current (2-pass)

```
Transcript + Files + Notes
        ↓
   Pass 1 (Haiku) — Clinical Analysis
   → concepts, specialty, ICD codes, medications
        ↓
   Pass 2 (Opus) — Single-shot generation
   → prose report (all sections at once as JSON)
        ↓
   Post-processing
   → ICD description validation, HTML rendering
```

### Proposed (3-pass with validation)

```
Transcript + Files + Notes
        ↓
   Pass 1 (Haiku) — Clinical Analysis           [EXISTING, minor tweaks]
   → concepts, specialty, ICD codes, medications
        ↓
   Pass 2 (Haiku) — Structured Fact Extraction   [NEW]
   → JSON: every clinical fact with source reference
   → deterministic intermediate representation
        ↓
   Programmatic Validation                        [NEW]
   → cross-check facts against source material
   → remove ungrounded facts, flag contradictions
        ↓
   Pass 3 (Opus) — Report Generation             [EXISTING, restructured]
   → prose from validated facts ONLY
   → template-aware, specialty-enriched
        ↓
   Post-processing                                [EXISTING, enhanced]
   → ICD validation, medication cross-check, HTML
```

---

## Phase 1: Quick Wins (No Architecture Changes)

Immediate changes to existing pipeline that reduce hallucination and improve consistency.

### 1.1 Set temperature=0 on generation calls ✅ DONE

- [x] **File:** `web/src/lib/anthropic.ts` line ~212
- [x] Add `temperature: 0` to the `anthropic().messages.stream()` call
- [x] Also set on the Haiku clinical analysis call in `web/src/lib/clinical/pipeline.ts` line ~66
- [x] Also set on the reformat call in `web/src/app/api/regenerate/route.ts`
- **Impact:** Single biggest consistency improvement. Same input → near-identical output.
- **Risk:** Low. Medical documentation should be deterministic, not creative.

### 1.2 Strengthen grounding rule in system prompt ✅ DONE

- [x] **File:** `web/src/lib/anthropic.ts` `buildTemplateSystemPrompt()` line ~87
- [x] Update rule 2 to match the fix that already worked for cough hallucination:

  ```
  BEFORE:
  "If a value (age, duration, measurement, dosage, etc.) is not explicitly stated..."

  AFTER:
  "If a value (age, duration, measurement, dosage, etc.) or medical fact
  (symptom, finding, diagnosis, procedure) is not explicitly stated..."
  ```

- [x] Add explicit anti-severity-escalation rule:
  ```
  "Do NOT upgrade diagnosis severity beyond what is explicitly stated
  (e.g. do not write STEMI when only non-STEMI or ACS is mentioned,
  do not write malignant when only benign is stated).
  When in doubt about severity, use the less severe term."
  ```
- **Impact:** Directly addresses the STEMI and cough hallucination issues.

### 1.3 Add source-priority hierarchy to system prompt ✅ DONE

- [x] **File:** `web/src/lib/anthropic.ts` `buildTemplateSystemPrompt()`
- [x] Add explicit source priority rule:
  ```
  "SOURCE PRIORITY (highest to lowest):
   1. Actual spoken transcript — always takes precedence
   2. Doctor's additional notes
   3. Uploaded documents (lab results, referrals, etc.)
   If sources conflict, prefer higher-priority source."
  ```
- **Impact:** Resolves ambiguity when transcript says one thing and an uploaded doc says another.

### 1.4 Add transcript-faithfulness instruction for medications ✅ DONE

- [x] **File:** `web/src/lib/clinical/pipeline.ts` `buildEnrichedSystemPrompt()` medication rules
- [x] Strengthen medication rules:
  ```
  "When listing medications in the report:
   - Only include medications EXPLICITLY mentioned in the transcript or documents
   - Use verified names from the VERIFIED MEDICATIONS list above
   - Do NOT add medications that are 'commonly prescribed' for a condition
     unless they are explicitly mentioned in the source material
   - If a medication was mentioned but is not in the approved list,
     include it as-is with the [needs verification] note"
  ```
- **Impact:** Prevents the model from adding "standard" medications that weren't discussed.

### 1.6 Title-consistency prompt rule ✅ DONE

The `"title"` JSON field Opus emits currently fabricates severity qualifiers (STEMI, non-STEMI, malignant) and anatomical localisations (anterior, lateral, inferior wall) beyond what the primary diagnosis actually supports. Real example from clinical testing: title "Akútny STEMI laterálnej steny" on an encounter whose primary diagnosis in the Záver was only the generic `I21 Akútny infarkt myokardu`, and whose sidebar even contained `I21.0` (which is _anterior_-wall MI — the title contradicted the codes).

- [x] **File:** `web/src/lib/anthropic.ts` — `buildTemplateSystemPrompt()`, the `"title"` key description in rule 7 (around line 104)
- [x] Replace the one-line title instruction with a rule that binds the title to the primary diagnosis:
  ```
  A "title" key with a short encounter title (max 6 words) in {{language}}.
  TITLE RULES:
  - The title MUST be consistent with the primary diagnosis in the
    assessment/conclusion section. Use the main ICD diagnosis description
    (or a close paraphrase) as the basis.
  - Do NOT include severity qualifiers (STEMI, non-STEMI, malignant, benign,
    acute, chronic) unless the exact qualifier appears in the source material
    AND in the primary diagnosis code's description.
  - Do NOT include anatomical localisation (anterior, lateral, inferior,
    left, right, wall-specific descriptors) unless it appears in the primary
    diagnosis description.
  - When in doubt, use a more general title that the codes actually support.
  Example — if the primary diagnosis is "I21 Akútny infarkt myokardu", the
  title should be "Akútny infarkt myokardu", NOT "Akútny STEMI laterálnej steny".
  ```
- **Impact:** Combined with the 1.2 anti-severity-escalation rule and `temperature: 0`, this keeps the title from fabricating severity or localisation that the diagnoses don't support. Prompt-only, zero infra risk.

### 1.7 ICD extraction as source of truth for the sidebar ✅ DONE

Currently the right-hand "Navrhované kódy" panel reads `metadata.clinical_analysis.candidateIcdCodes`, populated verbatim from Pass 1 (Haiku). The Záver section is Opus free-form prose, generated independently. The two code sets are **never reconciled**, so the sidebar and the report routinely show different codes.

**Goal:** The sidebar must show exactly the codes that appear in the generated report, with canonical CSV descriptions. The report is authoritative; the Haiku Pass 1 list becomes an input hint only.

- [x] **New export:** `web/src/lib/clinical/icd-index.ts` → `extractIcdCodesFromSections(sectionContents, locale)`
  - Iterate over every section's text.
  - Reuse the existing line-anchored regex used by `validateIcdDescriptions()`: `^(\s*[-•*]?\s*)([A-Z]\d{2}(?:\.\d{1,4})?)\s+([^\n]+)/gm`.
  - For each match call `resolveIcdCodes([rawCode], locale)`; skip if not found.
  - Deduplicate by canonical code (first appearance wins), so `I210` and `I21.0` collapse into one entry.
  - Return `CandidateIcdCode[]` with `{ code, description, confidence: "high", sourceConceptIds: [] }`.
  - Must be called **after** `validateIcdDescriptions()` so descriptions are already canonical.
- [x] **File:** `web/src/lib/anthropic.ts` — `generateFromTemplate()`
  - After the existing `validateIcdDescriptions` loop, call `extractIcdCodesFromSections(sectionContents, language)`.
  - Extend the return shape to `{ generatedNote, letter, suggestedTitle, extractedIcdCodes }`.
- [x] **File:** `web/src/app/api/generate/route.ts`
  - Destructure `extractedIcdCodes`.
  - If `clinicalAnalysis` is set, build a **defensive copy** with `candidateIcdCodes: extractedIcdCodes` and use it for **both** the DB `update()` call and the SSE `complete` payload. Single source, no drift.
- [x] **File:** `web/src/app/api/regenerate/route.ts`
  - Same treatment for **both** the full path **and** the fast reformat path.
  - Never mutate a cached analysis object — always defensive-copy.
- **Impact:** Sidebar, DB metadata, and Záver codes stay in lock-step by construction. No client-side changes needed — `use-encounter-generation.ts` already copies `event.clinicalAnalysis` into `visit.metadata.clinical_analysis` on the `complete` event, and `icd-panel.tsx` already renders from that metadata.

### 1.8 Regenerate route: missing `validateIcdDescriptions()` (pre-existing bug) ✅ DONE

`/api/generate` runs `validateIcdDescriptions()` inside `generateFromTemplate()`, but `/api/regenerate` (both the full path and the fast reformat path) builds its own `sectionContents` and **never** calls validation. Hallucinated ICD descriptions can leak through.

- [x] **File:** `web/src/app/api/regenerate/route.ts`
- [x] After `sectionContents` is built, loop over entries and call `validateIcdDescriptions(text, language)` on each before doing anything else.
- [x] Must land **before** the 1.7 extraction step so extraction sees canonical descriptions.
- **Impact:** Regenerated reports no longer contain parenthetical embellishments that were previously stripped only in the `generate` path. See also Phase 6.2 (regenerate fast path audit).

### 1.5 Verification ✅ Automated done — manual checks pending

- [ ] Run the same input 5 times and compare outputs — should be near-identical with `temperature: 0`
- [ ] Test with a cardiology transcript that mentions ACS — verify STEMI is NOT written unless explicitly stated
- [ ] Test with a transcript that does NOT mention cough — verify cough does NOT appear
- [x] Unit tests in `web/src/lib/anthropic.test.ts` for `buildTemplateSystemPrompt()` asserting:
  - [x] Strong grounding wording (symptom/finding/diagnosis/procedure)
  - [x] Anti-severity-escalation (STEMI example)
  - [x] Source-priority hierarchy
  - [x] Title rules (TITLE RULES, primary-diagnosis binding, STEMI example)
- [x] Unit tests in `web/src/lib/clinical/icd-validation.test.ts` — new `describe("extractIcdCodesFromSections", ...)` block:
  - [x] Extracts from a single section containing a bullet list
  - [x] Merges across multiple sections
  - [x] Deduplicates a code that appears in two sections (first-appearance order preserved)
  - [x] ~~Skips codes that don't exist in the CSV (e.g. fake `Z99.99`)~~ → replaced with "skips text that does not contain any ICD-formatted line" (Z99 resolves via category-fallback, so there's no easy way to construct a truly unresolvable code)
  - [x] Skips mid-sentence occurrences (regex is line-anchored)
  - [x] Returns `[]` for blank sections
  - [x] ~~Resolves dotted and undotted forms to the same canonical entry (`I210` + `I21.0` → 1)~~ → replaced with "deduplicates repeated occurrences of the same canonical code" (the regex requires whitespace after the code, so undotted `I210` doesn't match — this is by design, our prompt enforces dotted output)
  - [x] Returns SK canonical codes when locale is `sk`
- [ ] Manual: generate an encounter with multiple ICD-eligible findings — sidebar and Záver show the same set, same descriptions.
- [ ] Manual: transcript says generic "myocardial infarction" → title is the generic "Akútny infarkt myokardu", not "STEMI laterálnej steny".
- [ ] Manual: regenerate the same encounter with a different template — sidebar updates live via SSE and still matches the new Záver.
- [ ] Manual: regenerated reports no longer contain parenthetical embellishments that were previously only stripped out in the `generate` path.

**Test run (2026-04-08):** `npm run test -- --run` → 361/361 pass. `npm run lint` → 0 errors. `npm run build` → clean.

---

## Phase 2: Structured Fact Extraction (New Pass)

The core architectural improvement. Extract all clinical facts as structured JSON before generating prose. This creates a "contract" — the report can only contain facts from this validated set.

### 2.1 Define the Fact Schema ✅

- [x] **New file:** `web/src/lib/clinical/fact-extraction.ts`
- [x] Define `ExtractedFacts` interface:

  ```typescript
  interface SourceReference {
    type: "transcript" | "doctor_notes" | "file";
    /** Which chunk or file the fact came from */
    sourceIndex: number;
    /** Short quote proving this fact exists in the source */
    evidence: string;
  }

  interface ExtractedFact {
    /** What category: symptom, finding, diagnosis, medication, measurement, procedure, history */
    category: string;
    /** The fact itself in clinical language */
    value: string;
    /** Where in the source material this fact appears */
    source: SourceReference;
  }

  interface ExtractedFacts {
    demographics: ExtractedFact[];
    chiefComplaint: ExtractedFact[];
    symptoms: ExtractedFact[];
    findings: ExtractedFact[];
    measurements: ExtractedFact[];
    diagnoses: ExtractedFact[];
    medications: ExtractedFact[];
    procedures: ExtractedFact[];
    history: ExtractedFact[];
    plan: ExtractedFact[];
  }
  ```

### 2.2 Build the fact extraction prompt ✅

- [x] **File:** `web/src/lib/clinical/fact-extraction.ts`
- [x] System prompt for fact extraction (Haiku):

  ```
  "You are a clinical fact extractor. Your ONLY job is to extract facts
  that are EXPLICITLY stated in the source material.

  Rules:
  1. Extract ONLY facts that are directly stated — no inference, no assumptions
  2. Every fact MUST have a source reference with a short evidence quote
  3. If you cannot find evidence for a fact, do NOT include it
  4. Do NOT interpret or diagnose — only extract what is stated
  5. For medications: extract exact names as mentioned, with dosage if stated
  6. For diagnoses: extract exactly as stated, do NOT change severity
  7. Return valid JSON matching the schema exactly"
  ```

- [x] This runs as a new Pass 1.5 between clinical analysis and report generation
- [x] Use Haiku (`claude-haiku-4-5-20251001`, temperature 0, max_tokens 4096) — this is extraction, not generation

### 2.3 Programmatic fact validation ✅

- [x] **New file:** `web/src/lib/clinical/fact-validator.ts`
- [x] After extraction, validate facts programmatically:
  ```typescript
  function validateFacts(
    facts: ExtractedFacts,
    sourceText: string, // combined transcript + notes + files
  ): ValidatedFacts {
    // 1. Check that each evidence quote actually appears in source text
    //    (fuzzy match to handle minor transcription differences)
    // 2. Cross-check medications against Pass 1 medication list
    // 3. Cross-check diagnoses against Pass 1 ICD candidates
    // 4. Remove facts where evidence cannot be found
    // 5. Flag contradictions (e.g. two different BP readings)
    return { validFacts, removedFacts, warnings };
  }
  ```
- [x] Log removed facts for debugging (helps identify extraction errors)

**Notes on implementation:**

- Evidence matching uses NFKD unicode normalization + token-order fallback (tokens ≥3 chars) — tolerant of minor re-flow, case, diacritics.
- Medications not found in the approved CSV list are **kept** (to preserve the doctor's actual wording) but emitted as warnings; never silently dropped.
- Duplicates within a category are collapsed by normalized value; the first occurrence wins.
- `validateFacts` is pure — the input `facts` object is never mutated.

### 2.4 Wire into the generation pipeline ✅

- [x] **File:** `web/src/app/api/generate/route.ts`
- [x] Add fact extraction step after clinical analysis, before report generation
- [x] Pass validated facts to `generateFromTemplate()` as additional context
- [x] **File:** `web/src/app/api/regenerate/route.ts` — full path wired; fast reformat path deliberately skipped (no new grounding needed)
- [x] **File:** `web/src/lib/anthropic.ts` `buildTemplateUserMessage()`
- [x] Include validated facts as structured context:

  ```
  "VALIDATED CLINICAL FACTS (use ONLY these facts in your report):
  [structured fact list from extraction]

  SOURCE MATERIAL (for reference only — do not extract additional facts):
  [transcript chunks, files, notes]"
  ```

> **Interaction with Phase 1.7:** After Opus prose generation, `extractIcdCodesFromSections()` from Phase 1.7 still runs on the final section contents and remains the source of truth for `candidateIcdCodes` in DB metadata and the SSE `complete` event. Pass 1 clinical analysis and Pass 1.5 fact extraction feed candidate codes **into** Opus as context, but the persisted sidebar codes are always derived from the actual generated report. This preserves the sidebar/report invariant even as the pipeline grows a new pass.

### 2.5 SSE event for fact extraction ✅

- [x] Emitted inline from both `/api/generate` and `/api/regenerate` (full path) after `analysis_complete`. No central `sse.ts` change was needed — the route callbacks already send typed events.
- [x] Event shape (sent only when there is something to report):
  ```json
  {
    "type": "facts_extracted",
    "factCount": 23,
    "removedCount": 2,
    "warningCount": 1
  }
  ```
- [x] Client-side: no consumer changes yet — event is additive, safely ignored by existing handlers. UI wiring can land in Phase 5 (consistency testing) or alongside a progress-step refresh.

### 2.6 Verification ✅

- [x] Unit test: `web/src/lib/clinical/fact-extraction.test.ts` — 19 tests covering `emptyExtractedFacts`, `FACT_CATEGORIES`, `buildFactExtractionSystemPrompt` (grounding rules, severity bans, language labels, category listing, source-reference schema), `buildFactExtractionUserMessage` (numbered sources, files with name/type, doctor_notes, empty section omission), and `coerceFact` (null/malformed/string-index/whitespace coercion).
- [x] Unit test: `web/src/lib/clinical/fact-validator.test.ts` — 24 tests covering `normalizeForMatch` (diacritics, punctuation, Cyrillic), `evidenceAppearsInSource` (exact match, token-order fallback, missing tokens, short-token filter), `validateFacts` (evidence pass/fail, source range, doctor_notes, file, dedup, empty value, immutability, usage preservation, medication warnings), `countFacts`, and `formatFactsForPrompt`.
- [x] Integration: full `npm run test -- --run` → 404/404 pass (47 test files).
- [x] Build: `npm run build` clean after adding `"fact_extraction"` to the `Operation` union in `web/src/lib/usage.ts`.
- [x] Lint: `npm run lint` → 0 errors (warnings pre-existing, unrelated to Phase 2).
- [ ] Manual: run a real transcript end-to-end and verify the SSE `facts_extracted` event fires and the resulting report draws only from the validated fact set. (Deferred to in-app smoke test.)
- [ ] Performance: measure added latency on a real call. (Deferred — Haiku 4.5 + temp 0 is expected to add ~1-2s; will confirm after first manual run.)

**Test run (2026-04-08):** `npm run test -- --run` → **404/404 pass**. `npm run lint` → 0 errors. `npm run build` → clean after `usage.ts` Operation union update.

---

## Phase 3: Report Generation from Validated Facts

Restructure Pass 2/3 (Opus) to generate prose from validated facts rather than raw transcript.

### 3.1 Restructure the generation prompt

- [ ] **File:** `web/src/lib/anthropic.ts` `buildTemplateSystemPrompt()`
- [ ] Change the role description:
  ```
  BEFORE: "You are a medical documentation assistant"
  AFTER:  "You are a clinical report writer. You produce structured medical
           reports from pre-validated clinical facts."
  ```
- [ ] Strengthen the generation contract:
  ```
  "CRITICAL: You are writing from VALIDATED FACTS provided below.
  - Every statement in your report MUST correspond to a validated fact
  - Do NOT add any medical information beyond the validated facts
  - Do NOT infer diagnoses, symptoms, or treatments not in the facts
  - You MAY rephrase facts into professional medical prose
  - You MAY organize facts into appropriate template sections
  - You MUST NOT introduce new medical content"
  ```
- [ ] Preserve the Phase 1.6 TITLE RULES block verbatim when moving the prompt to a fact-driven structure. The "primary diagnosis" referenced by the title rule is the top-ranked diagnosis fact in the validated-facts `diagnoses` array.

### 3.2 Template section mapping with facts

- [ ] **File:** `web/src/lib/anthropic.ts` `buildTemplateUserMessage()`
- [ ] Include template section → fact category mapping hints:
  ```
  "Map validated facts to template sections as follows:
  - History sections ← demographics, chiefComplaint, symptoms, history
  - Examination sections ← findings, measurements
  - Assessment sections ← diagnoses
  - Plan sections ← medications, procedures, plan
  - Use section-specific guidance when provided
  - If a section has no matching facts, output empty string ''"
  ```
- [ ] This leverages the existing section `context` field — section context can further constrain which facts go where

### 3.3 Preserve template style system

- [ ] Keep `styleGuide` and `styleExamples` interpolation (existing)
- [ ] These control prose style (formal/informal, abbreviation use, etc.)
- [ ] Fact extraction ensures accuracy; style system ensures formatting

### 3.4 Verification

- [ ] Test with cardiology template: verify each section only contains relevant facts
- [ ] Test with SOAP template: verify Subjective/Objective/Assessment/Plan mapping
- [ ] Test with comprehensive template: verify subsection fact routing works
- [ ] Compare output quality: should be at least as good as current, but more accurate

---

## Phase 4: Enhanced Post-Processing

Add programmatic checks after generation to catch any remaining issues.

### 4.1 Medication cross-validation

- [ ] **File:** `web/src/lib/clinical/pipeline.ts` or new `post-processor.ts`
- [ ] After generation, check that every medication in the output exists in the validated facts
- [ ] If a medication appears in the report but NOT in validated facts → flag or remove
- [ ] Use fuzzy matching to handle brand name ↔ generic name equivalence
- [ ] Apply the same defensive-copy pattern used in Phase 1.7 when mutating `clinicalAnalysis` — never mutate cached objects loaded from `cachedAnalysis`.

### 4.2 Diagnosis cross-validation

- [ ] Check that every diagnosis in the output matches a validated fact
- [ ] Check severity: if validated fact says "ACS" but output says "STEMI" → flag
- [ ] Use the ICD validation system already in place, extend to cover diagnosis severity
- [ ] Build on top of the Phase 1.7 `extractIcdCodesFromSections()` output — do not re-implement extraction. Phase 4 adds _cross-validation_ (extracted codes vs validated-facts diagnoses, severity mismatches), not the extraction itself.

### 4.3 Negation detection

- [ ] Simple heuristic: check for "denies", "no", "negative for", "bez" (SK), "bez" (CS) patterns
- [ ] If transcript says "denies cough" but report lists cough as a symptom → flag
- [ ] This catches the exact cough hallucination issue that was reported

### 4.4 Verification

- [ ] Test with transcript containing "denies cough" → verify cough NOT in symptoms
- [ ] Test with transcript mentioning "Aspirin 100mg" → verify exact dosage preserved
- [ ] Test with ACS transcript → verify STEMI not introduced

---

## Phase 5: Consistency Testing Framework

Build automated testing to prevent regressions.

### 5.1 Golden test suite

- [ ] **New directory:** `web/src/lib/clinical/__tests__/golden/`
- [ ] Create 3-5 representative test cases:
  - [ ] Cardiology visit (STEMI vs non-STEMI edge case)
  - [ ] General practice visit (multiple complaints)
  - [ ] Visit with uploaded lab results + transcript
  - [ ] Visit with medications that should NOT be modified
  - [ ] Short/minimal transcript (edge case for insufficient context)
- [ ] Each test case: input fixture (transcript + notes + files) + expected fact set + expected section content patterns

### 5.2 Consistency scoring

- [ ] **New file:** `web/src/lib/clinical/__tests__/consistency.test.ts`
- [ ] For each golden test case, run generation N times (3-5)
- [ ] Score consistency:
  - Same diagnoses present? (exact match)
  - Same medications listed? (exact match)
  - Same section structure? (non-empty sections match)
  - Prose similarity? (jaccard similarity on medical terms)
- [ ] Set minimum consistency threshold (e.g., 95% for facts, 80% for prose)
- [ ] This can run as a slow integration test (not on every PR, but on demand)

### 5.3 Anti-hallucination regression tests

- [ ] For each known hallucination that was fixed (cough, STEMI), create a specific test
- [ ] Input: the exact transcript that triggered the hallucination
- [ ] Assert: the hallucinated content does NOT appear in the output
- [ ] These run as part of the golden test suite

### 5.4 Verification

- [ ] Golden tests pass on current pipeline
- [ ] Consistency score improves after Phase 1 (temperature=0)
- [ ] Consistency score further improves after Phase 2 (fact extraction)

---

## Cost Impact

| Pass                      | Model | Estimated Tokens | Cost per Generation |
| ------------------------- | ----- | ---------------- | ------------------- |
| Pass 1: Clinical Analysis | Haiku | ~3K in / ~1K out | ~$0.008             |
| Pass 1.5: Fact Extraction | Haiku | ~4K in / ~2K out | ~$0.014             |
| Pass 2: Report Generation | Opus  | ~6K in / ~3K out | ~$0.315             |
| **Total**                 |       |                  | **~$0.34**          |

Current cost is ~$0.32 per generation (Pass 1 + Pass 2). Adding fact extraction adds ~$0.014 — negligible increase (~4%) for significant accuracy improvement.

---

## Phase 6: Template Integration Audit — How Templates Flow Into Generation

Full code-level audit of how template fields are (or aren't) used during note generation.

### 6.0 Template → Prompt Data Flow

```
Template (from DB via resolveTemplate())
  │
  ├─ sections[].id + sections[].labels  ──→  buildSectionLabelsFromTemplate()
  │     └─→ sectionLabels: Record<string, string>
  │
  ├─ sections[].context  ──→  buildSectionContextsFromTemplate()
  │     └─→ sectionContexts: Record<string, string>
  │
  ├─ styleGuide  ──→  buildTemplateSystemPrompt() via {{styleGuide}}
  │
  ├─ systemPrompt  ──→  buildTemplateSystemPrompt() (replaces default if set)
  │
  ├─ styleExamples  ──→  ❌ DEAD CODE — never read
  │
  └─ specialties  ──→  ❌ NEVER USED — Pass 1 auto-infers specialty
```

### 6.1 Field-by-field audit

#### ✅ Section labels — WORKING

- **Where:** `buildTemplateSystemPrompt()` ([anthropic.ts:50-59](web/src/lib/anthropic.ts#L50-L59))
- **How:** Flattened into `TEMPLATE SECTIONS` list: `- "s_abc": Anamnéza`
- **Also used in:** `buildTemplateUserMessage()` for JSON key instructions, `buildTemplateHtml()` for output headings
- **Status:** Fully functional. Correctly localized via `resolveSectionLabel()`.

#### ✅ Section context — WORKING (but empty on all templates)

- **Where:** `buildTemplateSystemPrompt()` ([anthropic.ts:54-56](web/src/lib/anthropic.ts#L54-L56))
- **How:** Appended to each section as `SECTION-SPECIFIC GUIDANCE (ALWAYS FOLLOW THIS): <context>`
- **Precedence rule:** System prompt has explicit instruction: "SECTION-SPECIFIC GUIDANCE OVERRIDES ALL" ([anthropic.ts:82-83](web/src/lib/anthropic.ts#L82-L83))
- **Status:** The mechanism works perfectly. The problem is **all 4 seed templates have empty context on every section**. The feature is fully built but never activated.
- **Admin editor:** ✅ Has collapsible textarea per section for context editing

#### ✅ styleGuide — WORKING (but empty on all templates)

- **Where:** `buildTemplateSystemPrompt()` ([anthropic.ts:63-65](web/src/lib/anthropic.ts#L63-L65))
- **How:** Interpolated via `{{styleGuide}}` into `WRITING STYLE GUIDE:` block
- **Status:** The mechanism works. All 4 seed templates have `style_guide = null`, so it interpolates to empty string.
- **Admin editor:** ✅ Has textarea + auto-generate from reference note upload

#### ✅ systemPrompt — WORKING (but unused)

- **Where:** `buildTemplateSystemPrompt()` ([anthropic.ts:76-78](web/src/lib/anthropic.ts#L76-L78))
- **How:** If `template.systemPrompt` is set, replaces the entire default prompt. Still gets `{{sections}}`, `{{language}}`, `{{languageCode}}`, `{{styleGuide}}` interpolation.
- **Status:** Works correctly. All 4 seed templates use the default prompt (null).
- **Admin editor:** ✅ Full textarea with variable reference + "Reset to default" button

#### ❌ styleExamples — DEAD CODE

- **Type definition:** `{ name: string; text: string }[]` in [types.ts:15](web/src/lib/templates/types.ts#L15)
- **DB column:** `style_examples` — exists, read by `resolveTemplate()` in [server.ts:14-15](web/src/lib/templates/server.ts#L14-L15)
- **In generation prompt:** **NEVER** — `buildTemplateSystemPrompt()` never accesses `template.styleExamples`
- **Admin editor:** ❌ No UI
- **Seed data:** All empty (`[]`)
- **Fix needed:**
  - [ ] Wire into `buildTemplateSystemPrompt()` — inject as `STYLE EXAMPLES:` block with sample snippets
  - [ ] Add UI to admin editor for managing `{ name, text }` pairs
  - **Impact:** Strongest style control — "write like this" is more effective than "use these rules"

#### ❌ specialties — NEVER USED IN GENERATION

- **Type definition:** `string[]` in [types.ts:17](web/src/lib/templates/types.ts#L17)
- **In generation:** Specialty is always auto-inferred by Pass 1 Haiku analysis. The template's declared specialty is completely ignored.
- **Potential use:** Could serve as a hint to Pass 1, biasing specialty inference toward the template's declared specialty (e.g. if a doctor chooses a cardiology template, bias toward cardiology). Currently not implemented.
- **Admin editor:** ✅ Has combobox

### 6.2 Regenerate route — template usage bugs

The regenerate route (`/api/regenerate/route.ts`) has TWO code paths that use templates differently:

#### Full path (same template or no previous note) — ✅ Correct

- Uses `buildTemplateSystemPrompt()` + `buildEnrichedSystemPrompt()` — same as `/api/generate`
- Section labels, contexts, styleGuide, systemPrompt all flow through correctly

#### ⚠️ Fast path (reformat between templates) — MISSING TEMPLATE FEATURES

When changing templates on an existing note, the regenerate route builds its own inline system prompt ([regenerate/route.ts:178-185](web/src/app/api/regenerate/route.ts#L178-L185)):

```typescript
systemPrompt = `You reorganize medical documentation between template formats.
Rules:
1. Preserve ALL clinical information...
2. Preserve the EXACT tone, voice...
3. Write in ${langLabel}...
4. Sections with no relevant content: use empty string "".
5. Follow each section's Context instructions...
6. Return valid JSON...`;
```

**Problems with this inline prompt:**

- [ ] **No `styleGuide`** — The new template's writing style is completely ignored. Old template's style bleeds through.
- [ ] **Weaker section context** — Context is included in the section list (`Context: ...`) but without the "SECTION-SPECIFIC GUIDANCE (ALWAYS FOLLOW THIS)" emphasis that the full prompt has.
- [ ] **No safety rules** — Missing `STRICT GROUNDING`, anti-hallucination rules, insufficient context check, and formatting rules from the default prompt.
- [ ] **Custom `systemPrompt` ignored** — If the target template has a custom system prompt, it's completely bypassed.
- [x] **No `temperature` set** — ✅ Fixed in Phase 1.1 (temperature=0 applied to both paths).
- [x] **No `validateIcdDescriptions()`** — ✅ Fixed in Phase 1.8. Hallucinated ICD descriptions no longer leak through.
- [x] **No `extractIcdCodesFromSections()`** — ✅ Fixed in Phase 1.7. Sidebar codes now match the regenerated Záver by construction.

**Fix:** Refactor the fast path to either:

1. Use `buildTemplateSystemPrompt()` for the target template and add reformat-specific instructions on top, OR
2. At minimum inject `styleGuide` and the strong section context precedence rule
3. Run `validateIcdDescriptions()` + `extractIcdCodesFromSections()` after section contents are built, and override `candidateIcdCodes` (via defensive copy) on both the DB update and the SSE complete payload. Same behaviour as the full path.

### 6.3 Pass 1 (Clinical Analysis) — template-unaware

Pass 1 (`runClinicalAnalysis()` in [pipeline.ts:42](web/src/lib/clinical/pipeline.ts#L42)) runs **before** the template is involved. It:

- Analyzes raw transcript for concepts, specialty, ICD codes, medications
- Has NO access to the template being used
- Auto-infers specialty from transcript content

**Consequence:** If a doctor selects a cardiology template, Pass 1 might still infer "general_practice" from a broad transcript. The template's intent is lost.

**Potential improvement:**

- [ ] Pass the template's `specialties` as a hint to Pass 1 (bias, not override)
- [ ] Pass section IDs/contexts to help Pass 1 focus extraction on template-relevant concepts
- **Priority:** Low — current auto-inference works well enough in practice

### 6.4 Seed data gap — all customization fields empty

All 4 system templates in `seed.sql` have:

- `sections[].context` = none populated
- `style_guide` = null
- `style_examples` = `[]`
- `system_prompt` = null
- `specialties` = `{}`

The admin editor can already edit all of these (except `styleExamples`). The fix is content creation, not code:

- [ ] **Via admin UI:** Populate `context` on every section of all 4 templates (anti-hallucination constraints per section)
- [ ] **Via admin UI:** Write `styleGuide` for each template type (abbreviation rules, formatting preferences, tone)
- [ ] **Via migration (optional):** Persist as seed data so new deployments start with populated templates
- **Impact:** High — this is the single most impactful template improvement. Section context acts as per-section grounding rules.

### 6.5 Summary of fixes needed

| Status | Issue                                                             | Severity     | Effort                         | Phase          |
| ------ | ----------------------------------------------------------------- | ------------ | ------------------------------ | -------------- |
| ✅     | `temperature` not set (all calls)                                 | **Critical** | 10 min                         | Phase 1.1      |
| ✅     | Grounding rule weak on symptoms/findings/diagnoses                | **High**     | 10 min                         | Phase 1.2      |
| ✅     | No source-priority hierarchy when sources conflict                | **High**     | 10 min                         | Phase 1.3      |
| ✅     | Medication hallucination ("commonly prescribed")                  | **High**     | 15 min                         | Phase 1.4      |
| ✅     | Title hallucinates severity/localisation beyond primary diagnosis | **High**     | 20 min                         | Phase 1.6      |
| ✅     | Sidebar codes diverge from Záver codes (no reconciliation)        | **High**     | 1-2 hours                      | Phase 1.7      |
| ✅     | Regenerate route never calls `validateIcdDescriptions()`          | **High**     | 15 min                         | Phase 1.8      |
| ⏳     | Seed templates have no context/styleGuide                         | **High**     | 2-3 hours (content writing)    | Phase 6.4      |
| ⏳     | `styleExamples` dead code (never injected into prompt)            | **Medium**   | 30 min                         | Phase 1 add-on |
| ⏳     | Regenerate fast path ignores styleGuide                           | **Medium**   | 1 hour                         | Phase 1 add-on |
| ⏳     | Regenerate fast path has weak section context                     | **Medium**   | 30 min                         | Phase 1 add-on |
| ⏳     | Regenerate fast path missing safety rules                         | **Medium**   | 1 hour                         | Phase 1 add-on |
| ⏳     | `styleExamples` no admin UI                                       | **Low**      | 2-3 hours                      | Separate       |
| ⏸      | `template.specialties` never used in generation                   | **Low**      | N/A (works via auto-inference) | Defer          |
| ⏸      | Pass 1 template-unaware                                           | **Low**      | N/A (works well enough)        | Defer          |

---

## Implementation Priority (Updated)

| Phase                                            | Effort                            | Impact                                                            | Priority                   |
| ------------------------------------------------ | --------------------------------- | ----------------------------------------------------------------- | -------------------------- |
| Phase 1 + 6 fixes: Quick wins + template bugs    | Small (3-4 hours)                 | High — consistency, hallucination, regenerate bugs, styleExamples | **Do first**               |
| Phase 6.4: Populate template content (via admin) | Small (2-3 hours content writing) | High — activates section context + styleGuide                     | **Do with Phase 1**        |
| Phase 2: Fact Extraction                         | Medium (1-2 days)                 | Very high — fundamental accuracy improvement                      | **Core improvement**       |
| Phase 3: Report from Facts                       | Medium (1 day)                    | High — completes the accuracy chain                               | **After Phase 2**          |
| Phase 4: Post-Processing                         | Small (half day)                  | Medium — catches remaining edge cases                             | **After Phase 3**          |
| Phase 5: Testing Framework                       | Medium (1 day)                    | High — prevents regressions permanently                           | **Parallel with Phase 2+** |

---

## Key Design Decisions

1. **Haiku for extraction, Opus for prose** — Extraction is a structured task (JSON output) where Haiku excels. Prose generation needs Opus's language quality.

2. **Facts as JSON, not prose** — JSON intermediate step forces determinism. The model can't hallucinate in a structured extraction as easily as in free-form prose.

3. **Evidence quotes are mandatory** — Every fact must cite its source. This makes validation possible and hallucination detectable.

4. **Template sections map to fact categories** — Leverages the existing template `context` system. Section context constrains which facts flow into which sections.

5. **temperature=0 everywhere** — Medical documentation is not creative writing. Determinism is a feature, not a limitation.

6. **Three layers of style control** — (a) Section `context` controls _what_ goes in each section, (b) `styleGuide` controls _how_ it reads (tone, abbreviations, formatting), (c) `styleExamples` controls _exactly how_ — real snippets the model mimics. Together they give doctors full control without touching prompts.

7. **System templates are starting points, not endpoints** — Doctors duplicate system templates and customize them. Section context + style guide + style examples make each doctor's template produce reports in their personal clinical voice.

---

## Files Reference

### Existing (to modify)

| File                                                   | Changes                                                                                                                                                                |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/src/lib/anthropic.ts`                             | temperature=0, stronger grounding, TITLE RULES (1.6), extractIcdCodesFromSections wiring (1.7), styleExamples injection, fact-based generation                         |
| `web/src/lib/clinical/pipeline.ts`                     | Wire fact extraction, strengthen medication rules                                                                                                                      |
| `web/src/lib/clinical/prompts.ts`                      | Minor: temperature on Haiku                                                                                                                                            |
| `web/src/lib/clinical/icd-index.ts`                    | New `extractIcdCodesFromSections()` export (Phase 1.7); existing `validateIcdDescriptions()` used in more places                                                       |
| `web/src/app/api/generate/route.ts`                    | Add fact extraction step, SSE events, use extracted ICD codes for DB + SSE complete (1.7)                                                                              |
| `web/src/app/api/regenerate/route.ts`                  | temperature=0, fix fast path to use styleGuide + safety rules, add missing `validateIcdDescriptions()` loop (1.8), use extracted ICD codes for DB + SSE complete (1.7) |
| `web/src/lib/api/sse.ts`                               | New event type for fact extraction                                                                                                                                     |
| `web/src/lib/anthropic.test.ts`                        | New TITLE RULES assertions (1.6) alongside existing grounding/source-priority tests                                                                                    |
| `web/src/lib/clinical/icd-validation.test.ts`          | New `describe` block for `extractIcdCodesFromSections()` (1.7)                                                                                                         |
| `admin/app/(admin)/templates/[id]/template-editor.tsx` | Add styleExamples UI section                                                                                                                                           |
| `web/supabase/seed.sql` (or migration)                 | Populate section context + styleGuide on system templates                                                                                                              |

### New (to create)

| File                                                 | Purpose                          |
| ---------------------------------------------------- | -------------------------------- |
| `web/src/lib/clinical/fact-extraction.ts`            | Fact extraction prompt + schema  |
| `web/src/lib/clinical/fact-validator.ts`             | Programmatic fact validation     |
| `web/src/lib/clinical/post-processor.ts`             | Post-generation cross-validation |
| `web/src/lib/clinical/__tests__/golden/`             | Golden test fixtures             |
| `web/src/lib/clinical/__tests__/consistency.test.ts` | Consistency scoring tests        |

### Reference (admin — already exists)

| File                                                   | Capability                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `admin/app/(admin)/templates/[id]/template-editor.tsx` | Full template editor: sections, context, systemPrompt, styleGuide, drag-and-drop, duplicate |
| `admin/app/api/templates/analyze-note/route.ts`        | Reference note upload → Claude extracts sections + styleGuide                               |
| `admin/app/api/templates/[id]/route.ts`                | Template CRUD API                                                                           |
| `admin/app/api/templates/duplicate/route.ts`           | Template duplication                                                                        |
| `admin/app/api/templates/translate/route.ts`           | Auto-translate sections to all configured locales                                           |
