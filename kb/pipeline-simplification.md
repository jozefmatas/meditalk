# Pipeline Simplification: 5-Stage Architecture

## Context

The current generation pipeline has 11+ stages with 3 LLM calls (Sonnet + Haiku + Opus). Quality is suffering because:
1. **Too much "prompt law"** — long prompts cause partial model obedience
2. **Duplicated control** — same rules in extraction prompt, generation prompt, post-filter, template context, and specialty addendum
3. **Raw context surviving too late** — Opus sees raw OCR/transcript after facts are built, causing drift

The fix: simplify to **5 clean stages with 2 LLM calls** (Haiku + Opus). Eliminate the Sonnet clinical analysis pass entirely. Hide raw sources from the renderer.

## Target Architecture

```
Stage A — Input scrub          (deterministic TS)
Stage B — Fact extraction      (single Haiku call)
Stage C — State builder        (deterministic TS — buildEncounterState())
Stage D — Render               (single Opus call — EncounterState only, NO raw sources)
Stage E — Cleanup              (deterministic TS)
```

**What's eliminated:** Pass 1 (Sonnet clinical analysis) — concepts, clusters, ICD inference. Saves ~$0.04/call and ~4s latency. ICD codes are instead extracted deterministically from fact values against the CSV.

**What's consolidated:** Passes 1.6a, 1.6b, 1.7, 1.8, fact-to-section, ICD pre-render → single `buildEncounterState()`.

**What's simplified:** The Opus render prompt drops from ~400 tokens of rules to ~150. No grounding rules (done upstream), no routing rules (facts pre-assigned), no raw sources visible.

---

## Implementation Phases

### Phase 1: Deterministic ICD extraction from facts

**New files:**
- `web/src/lib/clinical/icd-from-facts.ts` — extract ICD codes from fact values using ICD CSV
- `web/src/lib/clinical/icd-from-facts.test.ts`

**Key function:**
```ts
extractIcdFromFacts(facts: ExtractedFacts, locale: SupportedLanguage): CandidateIcdCode[]
```

Strategy:
1. Scan `diagnoses` facts for literal ICD codes via regex `[A-Z]\d{2}(\.\d{1,4})?`
2. Scan `diagnoses` facts for description matches via `searchIcd()` from `icd-index.ts`
3. Scan all categories for embedded ICD codes
4. Validate all against CSV, deduplicate

Also add `inferSpecialtyFromIcd()` — map ICD chapter to specialty (I→cardiology, J→pulmonology, etc.).

**Risk:** ICD coverage may be lower without Sonnet inference.
**Mitigation:** Haiku's fact extraction already captures doctor-stated diagnoses. The CSV lookup handles the code-to-description mapping. Log comparison against current Pass 1 output on real encounters before switching.

**No existing code modified.** All additive.

---

### Phase 2: EncounterState type + buildEncounterState()

**New files:**
- `web/src/lib/clinical/encounter-state.ts` — `EncounterState` type definition
- `web/src/lib/clinical/build-encounter-state.ts` — consolidated Stage C
- `web/src/lib/clinical/build-encounter-state.test.ts`

**Key type:**
```ts
interface EncounterState {
  sectionFacts: Record<string, ExtractedFact[]>  // facts assigned to template sections
  unassignedFacts: ExtractedFact[]
  icdBlock: string              // pre-rendered verbatim ICD block
  icdCodes: CandidateIcdCode[]  // final filtered set
  allCandidateIcdCodes: CandidateIcdCode[]  // pre-filter (for ICD panel)
  inferredSpecialty: SpecialtyId
  visitDate?: string
  telemetry: EncounterStateTelemetry
}
```

**Key function:**
```ts
buildEncounterState(rawFacts, factInput, template, language, sectionLabels, sectionContexts?): EncounterState
```

Internal flow: `validateFacts` → `resolveFacts` → `extractIcdFromFacts` → `filterCertainIcdCandidates` → `classifyAssessment` → `assignFactsToSections` → `buildPreRenderedIcdBlock` → `inferSpecialtyFromIcd`.

**Reuses** all existing deterministic modules unchanged:
- `fact-validator.ts`, `fact-resolver.ts`, `icd-certainty.ts`, `assessment-classifier.ts`, `fact-section-assigner.ts`, `medication-normalizer.ts`

**No existing code modified.** All additive. Update `index.ts` exports.

---

### Phase 3: Simplified render prompt (Stage D)

**Modified file:** `web/src/lib/anthropic.ts`

**New functions (added alongside existing ones):**
- `buildStateBasedSystemPrompt(template, language, sectionLabels, encounterState)` — ~150 tokens of rules (vs ~400 current)
- `buildStateBasedUserMessage(encounterState, sectionLabels, allIds, visitDate?)` — facts + ICD block only, NO raw transcript/files/doctorNotes
- `generateFromEncounterState(encounterState, template, language, sectionLabels, ctx, onSection?)` — simplified generation

**What the new system prompt contains (only):**
1. Fact value fidelity (reproduce facts as-is, minimal grammar adjustment)
2. Output language
3. No bullets (with WRONG/CORRECT examples)
4. Parent sections empty
5. JSON format
6. ICD block verbatim copy
7. History compression

**What it drops:**
- Grounding/no-assumption rules (enforced in Stage C)
- Section routing rules (facts pre-assigned)
- Source priority (no raw sources visible)
- Insufficient context check (facts exist)
- Medication routing (pre-assigned)
- Specialty addendum (marginal value, adds prompt bulk)

**Old functions preserved** for backward compatibility (legacy regenerate path).

---

### Phase 4: Cleanup consolidation (Stage E)

**New file:** `web/src/lib/clinical/cleanup.ts`

**Key function:**
```ts
async function cleanupGeneratedNote(input: CleanupInput, ctx?): Promise<CleanupResult>
```

Consolidates all post-processing:
- `stripBulletMarkers()` per section
- Clear parent section content
- `scrubPhi()` per section (output PHI scrub)
- `validateIcdDescriptions()` per section
- Defensive ICD filter (strip codes not in allowed set)
- `extractIcdCodesFromSections()`
- `generateEncounterTitle()` (Haiku) or deterministic fallback
- `buildTemplateHtml()`

**New test file:** `web/src/lib/clinical/cleanup.test.ts`

---

### Phase 5: Rewire route.ts orchestration

**Modified files:**
- `web/src/app/api/generate/route.ts` — major simplification
- `web/src/app/api/regenerate/route.ts` — update full-generation path

**New orchestration:**
```ts
// Stage A — already exists (PHI scrub, lines 419-443)
// Stage B — single Haiku call
const rawFacts = await runFactExtraction(factInput, language, ctx);
// Stage C — single deterministic call
const encounterState = buildEncounterState(rawFacts, factInput, template, language, sectionLabels, sectionContexts);
// Stage D — single Opus call
const rendered = await generateFromEncounterState(encounterState, template, language, sectionLabels, ctx, onSection);
// Stage E — deterministic cleanup
const result = await cleanupGeneratedNote({ parsedSections: rendered.parsedSections, ... }, ctx);
```

**Removed from route.ts:**
- `runClinicalAnalysis()` call (Sonnet — the entire Pass 1)
- `embeddingPromise` / legacy embedding search
- Scattered deterministic pass calls (replaced by `buildEncounterState`)
- Post-processing logic (replaced by `cleanupGeneratedNote`)

**Metadata changes:**
- `metadata.clinical_analysis` preserved with: `matchedConcepts: []`, `problemClusters: []`, `candidateIcdCodes` from `encounterState.icdCodes`
- New `metadata.encounter_state` — cacheable for structured rerender
- `matchedConcepts`/`problemClusters` confirmed unused in UI (no `.tsx` references)

**Regenerate path:** Check for `metadata.encounter_state` first (new), fall back to `metadata.validated_facts` + `buildEncounterState()` (old).

---

### Phase 6: Dead code removal

**Delete files:**
- `web/src/lib/clinical/prompts.ts` — only used by `runClinicalAnalysis`
- `web/src/lib/clinical/clinical-concepts.ts` — only used by Pass 1
- `web/src/lib/clinical/regional-terms.ts` — only used by Pass 1

**Remove from `pipeline.ts`:**
- `runClinicalAnalysis()`
- `buildRegionalTermsReference()`
- `buildConceptTriggersReference()`

**Simplify in `pipeline.ts`:**
- `buildEnrichedSystemPrompt()` → only specialty pack + ICD block (no concepts/clusters/medications)

**Deprecate in `anthropic.ts`:** (keep for legacy but mark deprecated)
- `buildTemplateSystemPrompt()`, `buildTemplateUserMessage()`, `generateFromTemplate()`

**Update:** `index.ts` exports, `pipeline.test.ts`, `fingerprint.ts`

---

## Critical Files

| File | Action |
|------|--------|
| `web/src/lib/clinical/icd-from-facts.ts` | NEW — deterministic ICD extraction |
| `web/src/lib/clinical/encounter-state.ts` | NEW — EncounterState type |
| `web/src/lib/clinical/build-encounter-state.ts` | NEW — consolidated Stage C |
| `web/src/lib/clinical/cleanup.ts` | NEW — consolidated Stage E |
| `web/src/lib/anthropic.ts` | MODIFY — add state-based prompts + generateFromEncounterState |
| `web/src/app/api/generate/route.ts` | MODIFY — simplify to 5-stage flow |
| `web/src/app/api/regenerate/route.ts` | MODIFY — use new pipeline |
| `web/src/lib/clinical/pipeline.ts` | MODIFY — remove runClinicalAnalysis, simplify enrichment |
| `web/src/lib/clinical/index.ts` | MODIFY — update exports |
| `web/src/lib/clinical/prompts.ts` | DELETE |
| `web/src/lib/clinical/clinical-concepts.ts` | DELETE |
| `web/src/lib/clinical/regional-terms.ts` | DELETE |

## Reused Modules (unchanged)

- `fact-extraction.ts` — Haiku fact extraction (Stage B)
- `fact-validator.ts` — evidence grounding check
- `fact-resolver.ts` — self-correction detection
- `icd-certainty.ts` — lexical ICD grounding
- `assessment-classifier.ts` — tier classification
- `fact-section-assigner.ts` — fact-to-section routing
- `medication-normalizer.ts` — parse/reconstruct medications
- `medication-index.ts` — medication DB lookup
- `phi-scrubber.ts` — PHI removal
- `icd-index.ts` — ICD CSV lookup
- `templates/html.ts` — HTML rendering

## Test Strategy

- **Phases 1-4 are purely additive** — all 761 existing tests continue to pass
- Each new module gets its own test file before integration
- Phase 5 (switchover) updates `pipeline.test.ts` and route tests
- Phase 6 (deletion) removes tests for deleted functions

## Verification

After each phase:
1. `npx vitest run` — all tests pass
2. `npm run lint` — no errors
3. `npm run build` — no type errors

After Phase 5 (full switchover):
4. Manual test: generate a report from a real encounter, compare output quality
5. Verify ICD codes are correctly extracted from facts (compare against previous Pass 1 output)
6. Verify SSE events still work (analysis_complete, facts_extracted, streaming_start, section, complete)
7. Verify regenerate path works with both old (validated_facts) and new (encounter_state) cached data

## Commit Strategy

One commit per phase. Each commit includes KB doc updates (`kb/prompt-pipeline.md`, `kb/documentation.md`).
