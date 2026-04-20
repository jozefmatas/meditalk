# Tiered Section-by-Section Rendering

## Context

The single Opus 4.6 call generates ALL template sections at once. Despite deterministic fact-to-section assignment and post-processing passes (A/B/C), Opus still:
- Pulls medication lists from raw file texts into OA/SA sections
- Adds narrative text to the Assessment section instead of just ICD codes
- Cross-contaminates sections (substance use in SA, allergies in EA)

The root cause: Opus sees doctor notes + file texts alongside assigned facts and deviates from the fact contract. Post-processing catches many errors but is a band-aid.

**Solution**: Split generation into 3 tiers — each section rendered by the most appropriate method:
- **Deterministic** (no LLM): LA, Assessment — always perfect, instant, free
- **Haiku batch** (one call): History + exam sections — cheap, fast, focused
- **Opus narrative** (one call): TO/HPI + Plan — rich narratives where it matters

Benefits: ~60% cost reduction ($0.05 vs $0.15), ~40% faster (12s vs 20s), structurally impossible to misroute deterministic sections.

---

## Architecture Overview

```
Current:  Facts → Single Opus call (ALL sections) → Post-processing → HTML

New:      Facts → assignFactsToSections()
            ├─ Deterministic: LA, Assessment → instant, emit immediately
            ├─ Haiku batch: RA,OA,SA,PA,EA,AA,Ab,Exam → ~3-5s (parallel)
            └─ Opus narrative: TO, Plan → ~8-12s (parallel with Haiku)
          → Merge results → Simplified post-processing → HTML
```

Haiku and Opus run in **parallel** — total latency ≈ max(5s, 12s) ≈ 12s.
Streaming: deterministic sections emit instantly, then Haiku/Opus sections stream in as they complete.

---

## Step 1: Extend Section Classification

**File:** `web/src/lib/clinical/section-routing-validator.ts`

Add 3 new roles to `SectionRole` type:

```typescript
type SectionRole =
  | "medications" | "substanceUse" | "allergies" | "epidemiological"
  | "plan" | "personalHistory" | "socialHistory"
  | "assessment"      // NEW — Záver/Assessment
  | "chiefComplaint"  // NEW — TO/HPI
  | "findings"        // NEW — Exam sections
  | "other";
```

Add to `ROLE_PATTERNS`:
```typescript
["assessment", ["zaver", "assessment", "conclusion", "diagnoz"]],
["chiefComplaint", ["terajsie", "present illness", "hpi", "chief complaint", "dovod"]],
["findings", ["nalez", "finding", "objektivny", "status praesens", "physical exam"]],
```

Export `classifySection` (currently internal).

---

## Step 2: Create Section Renderer

**New file:** `web/src/lib/clinical/section-renderer.ts`

### 2a. Tier Classification

```typescript
export type RenderTier = "deterministic" | "haiku" | "opus";

export function classifySectionTiers(
  sectionLabels: Record<string, string>,
  sectionContexts?: Record<string, string>,
): SectionTier[]
```

Mapping from SectionRole → RenderTier:
| Role | Tier | Rationale |
|------|------|-----------|
| `medications` | deterministic | Pre-validated facts, just list them |
| `assessment` | deterministic | Pre-rendered ICD block, verbatim copy |
| `chiefComplaint` | opus | Needs temporal narrative |
| `plan` | opus | Needs clinical reasoning |
| Everything else | haiku | Simple formatting of pre-assigned facts |

### 2b. Deterministic Renderers

Two simple functions, no LLM:

**`renderMedications(facts)`**: Join medication fact values with `", "` (compact inline per formatting rule 6 in `buildFactBasedSystemPrompt`). Already validated/corrected by fact-validator. Returns `""` if no facts.

**Assessment**: Return `icdBlock` verbatim (from `buildPreRenderedIcdBlock` in `pipeline.ts`). No LLM needed — ICD codes are already filtered by Pass 1.7/1.8.

### 2c. Haiku Batch Renderer

Single Haiku 4.5 call for ALL non-narrative sections: RA, OA, SA, PA, EA, AA, Ab, exam subsections, demographics, other.

**System prompt** (~200 tokens):
- Write in {language}, compact flowing prose
- No bullets, no fabrication, preserve fact wording
- For exam sections: distribute undistributed findings by context

**User message**:
- Each section with its pre-assigned facts + context
- `UNDISTRIBUTED FINDINGS` block for facts assigned to parent exam sections (since parents get cleared by Pass B, their findings need redistribution to subsections)
- Unassigned (`_unassigned`) facts included as "general context"
- Output: JSON `{"sectionId": "formatted text", ...}`

**Model**: `claude-haiku-4-5-20251001`, temp 0, max_tokens 4096

### 2d. Opus Narrative Renderer

Single Opus 4.6 call for TO/HPI and Plan only.

**System prompt** (~300 tokens):
- Rich temporal narrative for HPI/TO (onset → progression)
- Flowing prose for Plan (recommendations)
- Do NOT list medications/diagnoses (they have dedicated sections)
- Specialty prompt addendum from `getSpecialtyPromptPack()` (reuse from `pipeline.ts`)
- Style guide from template (if present)

**User message**:
- Encounter date (for temporal resolution)
- Medication + diagnosis context (reference only, NOT for listing)
- Each section with pre-assigned facts
- Doctor notes + file texts (only Opus sees raw unstructured input)
- Output: JSON `{"sectionId": "formatted text", ...}`

**Model**: `claude-opus-4-6`, temp 0, max_tokens 4096

### 2e. Findings Redistribution

Problem: `assignFactsToSections` assigns ALL findings to a single parent section (e.g., "Objektívny nález") which gets cleared by Pass B. Exam subsections ("Cardiovascular", "Respiratory") get no individual facts.

Solution: Before the Haiku call, detect facts assigned to parent sections (sections with subsections). Extract their `findings`/`measurements` category facts as "undistributed". Include in Haiku prompt — Haiku distributes using subsection contexts.

Reuse `collectParentSectionIds` from `anthropic.ts` (line 73).

### 2f. Main Orchestration

```typescript
export async function renderSections(
  template: Template,
  sectionLabels: Record<string, string>,
  factAssignment: Record<string, ExtractedFact[]>,
  language: SupportedLanguage,
  options?: {
    sectionContexts?: Record<string, string>;
    icdBlock?: string;
    clinicalAnalysis?: ClinicalAnalysis;
    doctorNotes?: string;
    fileTexts?: Array;
    visitDate?: string;
    styleGuide?: string;
    onSection?: (id: string, title: string, content: string) => void;
  },
  ctx?: UsageContext,
): Promise<{ sectionContents: Record<string, string>; usage: RenderUsage }>
```

Flow:
1. Classify all sections into tiers
2. Render deterministic sections → emit via `onSection` immediately
3. Build medication/diagnosis context strings from deterministic results
4. Extract undistributed findings from parent sections
5. Start Haiku + Opus streams **in parallel** (both use `extractSectionsFromStream` for streaming)
6. Await both → merge all results into `sectionContents`
7. Return results + token usage

---

## Step 3: Integrate into `anthropic.ts`

**In `generateFromTemplate`** (line 568), replace the single Opus call block (lines 594–713) with a branching condition:

```typescript
if (hasValidatedFacts) {
  // NEW PATH: Tiered rendering
  const factAssignment = assignFactsToSections(validatedFacts, sectionLabels, sectionContexts);
  const icdBlock = clinicalAnalysis
    ? buildPreRenderedIcdBlock(clinicalAnalysis.candidateIcdCodes)
    : undefined;

  const { sectionContents: rendered, usage: renderUsage } = await renderSections(
    template, sectionLabels, factAssignment, language,
    { sectionContexts, icdBlock, clinicalAnalysis, doctorNotes, fileTexts,
      visitDate, styleGuide: template.styleGuide, onSection },
    ctx,
  );

  for (const id of allIds) {
    sectionContents[id] = rendered[id] || "";
  }
} else {
  // LEGACY PATH: Single Opus call (unchanged — handles insufficient_context, custom prompts)
  // ... existing code
}
```

**Simplify post-processing** for the new path:
- **Pass A** (strip bullets): Still runs on all sections
- **Pass B** (clear parents): Still runs
- **Pass C** (section routing): Only runs on Opus sections (deterministic/Haiku can't misroute)
- **PHI scrub**: Still runs on all sections
- **Pass 2.5** (ICD enforcement): Skip assessment sections (already deterministic)

**Fallback to legacy path** when:
- No validated facts (`!hasValidatedFacts`)
- Custom system prompt on template (`template.systemPrompt`)
- This ensures backward compatibility

---

## Step 4: Tests

**New file:** `web/src/lib/clinical/section-renderer.test.ts`

### Tier Classification (6 tests)
- LA → deterministic, AA → haiku, Ab → haiku, Assessment → deterministic
- TO → opus, Plan → opus
- RA/OA/SA/PA/EA → haiku
- Exam subsection with "vyšetrenie" context → haiku

### Deterministic Renderers (4 tests)
- Medications: joins facts with ", "
- Medications: empty facts → ""
- Assessment: returns ICD block verbatim
- Assessment: no ICD block → ""

### Prompt Builders (4 tests)
- Haiku system prompt: contains language, rules, no bullets
- Haiku user message: sections with facts, undistributed findings block
- Opus system prompt: contains specialty addendum when available
- Opus user message: contains medication/diagnosis context, doctor notes

### Findings Redistribution (3 tests)
- Parent section findings detected as undistributed
- Non-findings facts in parent sections NOT redistributed
- No parent sections → empty undistributed list

### Edge Cases (3 tests)
- Empty facts → returns ""
- Unassigned facts → included in Haiku batch
- All sections deterministic (rare) → no LLM calls

---

## Step 5: Update exports + KB docs

**`web/src/lib/clinical/index.ts`**: Export `renderSections`, `classifySectionTiers`, `RenderTier`, `SectionTier` from section-renderer. Export `classifySection`, `SectionRole` from section-routing-validator.

**`kb/prompt-pipeline.md`**: Update Pass 2 description — tiered rendering, parallel Haiku+Opus, deterministic LA/Assessment.

**`kb/documentation.md`**: Update Generation Pipeline section — new architecture, cost/latency improvements.

---

## Files Changed Summary

| File | Change |
|------|--------|
| `web/src/lib/clinical/section-renderer.ts` | **NEW** — tier classification, deterministic renderers, Haiku/Opus prompt builders, orchestration |
| `web/src/lib/clinical/section-renderer.test.ts` | **NEW** — 20+ tests |
| `web/src/lib/clinical/section-routing-validator.ts` | Extend `SectionRole` (+3 roles), export `classifySection` |
| `web/src/lib/anthropic.ts` | Branch fact-based path to tiered rendering, simplify post-processing |
| `web/src/lib/clinical/index.ts` | Add exports |
| `kb/prompt-pipeline.md` | Update Pass 2 section |
| `kb/documentation.md` | Update generation pipeline description |

### Reused as-is (no changes)
- `fact-section-assigner.ts` (fact-to-section mapping)
- `fact-validator.ts` (`normalizeForMatch`)
- `pipeline.ts` (`buildPreRenderedIcdBlock`, `getSpecialtyPromptPack`)
- `api/sse.ts` (`extractSectionsFromStream` — reused for both Haiku/Opus streams)
- `templates/html.ts` (`buildTemplateHtml`, `flattenSectionIds`)
- `json-repair.ts` (`extractJson`)
- `phi-scrubber.ts`
- `section-routing-validator.ts` (Pass C, kept as safety net for Opus sections)

---

## Known Gaps (follow-up work)

1. **No `allergies` fact category**: ExtractedFacts has no allergies category — allergy info is currently inferred by Opus from context. AA section goes to Haiku tier (not deterministic) so Haiku handles it from whatever facts are assigned. Adding an explicit allergies category to fact extraction would improve this.

2. **Findings distribution is coarse**: `CATEGORY_SECTION_PATTERNS` assigns ALL findings to one section. Haiku handles redistribution via contexts, but adding body-system keyword matching to the assigner would be more precise.

---

## Verification

1. `cd web && npx tsc --noEmit` — zero type errors
2. `cd web && npx vitest run` — all tests pass (790+ existing + 20 new)
3. `cd web && npm run lint` — zero errors
4. `cd web && npm run build` — clean build
5. Manual test: regenerate STEMI encounter and verify:
   - LA has ONLY medications (no meds in OA/SA)
   - Assessment has ONLY ICD codes (no narrative)
   - TO has rich temporal narrative
   - Plan has clinical recommendations
   - Exam subsections have distributed findings
6. Compare latency (target <15s) and cost (target <$0.08)
7. Streaming: deterministic sections appear instantly, then Haiku/Opus fill in
