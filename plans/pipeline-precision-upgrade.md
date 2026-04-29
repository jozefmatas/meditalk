# Pipeline Precision Upgrade

_Created: 2026-04-28 — from grill sessions exploring (1) whether the 2-pass architecture (Haiku render → Sonnet critic) is optimal, and (2) whether Záver needs special treatment._

---

## Problem Statement

The current pipeline uses Haiku (cheapest model) for the **harder** task (rendering clinical prose from raw source) and Sonnet (stronger model) for the **easier** task (auditing a draft against source). This is inverted. Rendering requires clinical judgment, cross-reference, and voice matching; auditing is a simpler comparison task.

Additionally, real doctor feedback reveals that file-uploaded content (lab results, referral letters) gets routed to ALL sections after extraction, causing:
- ICD suggester hallucinating diagnoses from medication-only text
- Medications appearing in wrong sections (therapy listed under diagnosis)
- Generic drug names instead of specific brands from the source

The Záver (Conclusion) section is treated as a special case — bypasses `renderSection` entirely, generated deterministically from ICD codes via `formatZaverFromSuggestions()`. This produces an ICD code list, not a clinical conclusion. Doctors expect natural prose ("Akútny NSTEMI laterálnej steny. Artériová hypertenzia III. st."), not code lines ("I21.4 Akútny subendokardiálny infarkt myokardu"). Additionally, the multi-`<p>` HTML structure creates invisible characters (tabs, newlines) that are nearly impossible to remove when pasted into NIS (hospital information systems).

The eval harness has only 3 fixtures — too thin to catch regressions reliably.

---

## Decisions (from grill sessions)

### Session 1: Model Tiers & Pipeline Architecture

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Swap to **Sonnet render** for narrative sections | Harder task deserves the stronger model |
| 2 | Keep critic as **Haiku everywhere** | Defense-in-depth; verification ≠ generation; Haiku is sufficient for comparison |
| 3 | Tiered rendering: **Sonnet for narrative**, **Haiku for structural** | Vitals, allergies, BMI don't need Sonnet's reasoning |
| 4 | A/B test **removing skeleton** once Sonnet render is stable | Skeleton was compensating for Haiku's weakness at cross-reference |
| 5 | Classify extracted passages by **category** (medication, diagnosis, finding, procedure) and route to matching sections | Fixes the "everything goes everywhere" file routing problem |
| 6 | Capture doctor feedback as **eval fixtures** systematically | 3 fixtures → target 10+ with diverse error types |
| 7 | Rename Slovak identifiers to English | Code should be navigable regardless of language |
| 8 | Explore **single-call generation** as a future architecture | One Sonnet/Opus call generates all sections holistically; eliminates cross-section leaking |

### Session 2: Záver (Conclusion) Normalization

| # | Decision | Rationale |
|---|----------|-----------|
| 9 | **Záver becomes DETERMINISTIC** — no LLM call, no critic, no reconcilers | ICD suggester already identifies diagnoses; formatting them is a pure function. Eliminates ~200 lines of special-case logic + saves one Sonnet call per generation |
| 10 | **ICD suggestions are the sole content source** — `formatConclusionContent(codes)` maps high/medium confidence codes to canonical descriptions | Deterministic, reliable, no hallucination risk. Ordering matches ICD suggester's ranking (primary first) |
| 11 | **Output is canonical ICD descriptions, one per line, no code numbers** — "Akútny transmurálny infarkt myokardu na iných miestach" not "I21.1 ..." | ICD code numbers live exclusively in the right-side panel; Záver contains the human-readable description |
| 12 | **Ordering: ICD suggester ranking** — primary diagnosis first, then other high/medium confidence codes | The suggester already applies clinical judgment for ranking; no LLM reordering needed |
| 13 | **Delete `formatZaverFromSuggestions`** and `format-zaver.ts` entirely | Replaced by `formatConclusionContent` in `pipeline.ts` — simpler format (descriptions only, no codes) |
| 14 | **Drop `icd-validator` reconciler from Záver** | No LLM output to validate; content is deterministic from ICD suggester |
| 15 | **Delete `shouldRerunZaver()`** — adjust router handles Záver normally | The adjust router + ICD suggester re-run cover the same cases; eliminates hardcoded Slovak label regex |
| 16 | **Záver renders last** (after ICD suggester completes) — deterministic from suggestions | Zero latency cost (suggester runs in parallel with other sections); result is immediate once suggestions resolve |
| 17 | **Fixes NIS formatting bug** — each diagnosis on its own line, no ICD codes | Old multi-`<p>` ICD code lines caused tabs/newlines in NIS; per-line canonical descriptions are clean and easy to scan |

---

## Phase 1: Model Tier Swap

**Goal:** Sonnet renders narrative sections, Haiku renders structural ones, Haiku critics everything.

### Section Classification

Introduce `section.kind` — a new field on template sections that drives model selection, voice-example suppression, and (later) passage routing.

| Kind | Examples | Render model | Critic model |
|------|----------|-------------|-------------|
| `exam-narrative` | OA (Objektívny nález), Celkové vyšetrenie | Sonnet | Haiku |
| `history-narrative` | TO (Terajšie ochorenie), EA (Epidemiologická anamnéza) | Sonnet | Haiku |
| `conclusion` | Záver / Assessment | Sonnet | Haiku |
| `medication-list` | LA (Lieková anamnéza) | Haiku | Haiku |
| `vital-numeric` | TK, Pulz, Výška, Hmotnosť, BMI, EKG | Haiku | None (skip critic) |
| `default` | AA, RA, SA, PA, GA, Pracovná neschopnosť | Haiku | Haiku |

### Changes

**`web/src/lib/sections/pipeline.ts`:**
- `KIND_POLICY` matrix already exists — update it to use Sonnet for `exam-narrative`, `history-narrative`, `conclusion`
- `deriveKind()` already classifies sections by label — verify coverage matches the table above
- Critic model selection: always Haiku regardless of section kind (override the current "Sonnet for non-LA" critic)
- **Remove `skipRenderInMainLoop: true` from the `conclusion` kind** — Záver now renders in the main loop

**`web/src/lib/sections/critic.ts`:**
- Change default critic model from Sonnet to Haiku
- Remove the `isLaTitle` check that currently forces Haiku only for LA — now everything is Haiku
- The `model` parameter stays for future flexibility but defaults to `"haiku"`

**`kb/prompt-pipeline.md`:**
- Update §0 (Pipeline Overview), §3 (Per-section Model Selection), §4 (Critic pass) to reflect new defaults

### Verification
- Run eval harness: `EVAL_VERBOSE=1 pnpm exec tsx scripts/run-evals.ts`
- Compare scores against baseline (currently 79-81/84)
- Manual spot-check on 2-3 real encounters: narrative quality should improve, structural sections unchanged
- Monitor cost per generation (expect slight increase from Sonnet rendering, offset by Haiku critic savings)

---

## Phase 2: Záver Normalization (Conclusion becomes deterministic)

**Goal:** Záver is deterministic — `formatConclusionContent(codes)` maps ICD suggestions to canonical descriptions (one per line, no code numbers). No LLM call, no critic, no reconcilers. Fixes NIS formatting bug.

### What gets deleted

| File / Function | Reason |
|----------------|--------|
| `web/src/lib/sections/format-zaver.ts` | Replaced by `formatConclusionContent` in `pipeline.ts` |
| `web/src/lib/sections/format-zaver.test.ts` | Tests for deleted formatter |
| `shouldRerunZaver()` in `adjust-helpers.ts` | Adjust router handles Záver like any other section |
| `icd-validator` reconciler on Záver | No LLM output to validate; content is deterministic |
| Záver-specific code path in `session.ts` (~40 lines) | Záver still renders last, but deterministically |

### What gets added/changed

**`web/src/lib/pipeline/session.ts`:**
- Remove the entire "Step 5: Záver" block (lines ~149-190)
- Pass `icdSuggestionsPromise` to `generateNote` — conclusion sections await it
- Záver renders **last** in the loop (after awaiting ICD suggester results)

**`web/src/lib/sections/pipeline.ts`:**
- `formatConclusionContent(codes: SuggestedIcdCode[]): string` — takes high/medium confidence codes, returns `descriptions.join("\n")`
- Conclusion sections bypass `renderLeaf` entirely — no `renderSection`, no critic, no reconcilers
- `generateNote` accepts optional `icdSuggestionsPromise` parameter
- `KIND_POLICY.conclusion.renderModel` is kept as `"sonnet"` for type completeness but unused

**Output format** (example):
```
Akútny transmurálny infarkt myokardu na iných miestach
Primárna [esenciálna] artériová hypertenzia
Diabetes mellitus 2. typu bez komplikácií
```

- Only high/medium confidence codes included (low stays in panel only)
- **No ICD code numbers** — only the canonical description from the ICD CSV
- Ordering follows the ICD suggester's ranking (primary first)

**`web/src/lib/pipeline/adjust-helpers.ts`:**
- Delete `shouldRerunZaver()` entirely
- The adjust router classifies Záver like any other section
- If the ICD suggester re-runs on adjust (it does), new suggestions feed into deterministic formatting automatically

### NIS formatting fix

The root cause: `formatZaverFromSuggestions` produced comma-separated ICD codes with code numbers → `renderContent()` wrapped in `<p>` → pasting into NIS produced invisible tab/newline characters.

The fix: `formatConclusionContent` outputs clean canonical descriptions, one per line. No ICD code numbers, no clinical shorthand, no LLM prose — just the official ICD-10 description text. Both copy paths are fixed:
- "Copy note" button (custom `navigator.clipboard.write`) — clean per-line text, no invisible characters
- Ctrl+C from section editor (tiptap) — each paragraph is a single description line, no extra tab/newline artifacts

### Verification
- Unit tests for `formatConclusionContent` — empty, low-confidence filtering, newline joining, no code numbers
- Manual test: generate → copy → paste into a text field — verify no invisible characters
- Manual test: adjust mode — change TO content → verify Záver re-runs with updated diagnoses

---

## Phase 3: Rename Slovak Identifiers

**Goal:** All code-level identifiers in English. Slovak stays only in user-facing strings, template data, and prompt content.

### Renames

| Current | New | Files |
|---------|-----|-------|
| `findZaverSection()` | `findConclusionSection()` | `pipeline.ts` |
| `LEGACY_ZAVER_LABELS` | `CONCLUSION_LABELS` | `pipeline.ts` |
| `LEGACY_LA_LABELS` | `MEDICATION_LIST_LABELS` | `pipeline.ts` |
| `ZAVER_LABELS` (in pipeline docs) | `CONCLUSION_LABELS` | `kb/prompt-pipeline.md` |
| `isLaTitle()` | Remove entirely (replaced by `kind === "medication-list"` from Phase 1) | `pipeline.ts`, `critic.ts` |

Note: `formatZaverFromSuggestions`, `format-zaver.ts`, `format-zaver.test.ts`, and `shouldRerunZaver` are already deleted in Phase 2 — no rename needed.

### Rules
- Update all imports across the codebase
- Update `kb/prompt-pipeline.md` references
- Comments/docstrings that say "Záver" in an explanatory context (e.g. "the Záver section is the clinical conclusion") are fine — they explain domain concepts
- Template data in the DB keeps Slovak labels — those are user-facing

---

## Phase 4: Passage Classification for File Routing

**Goal:** Extracted file passages are tagged by clinical category so sections only see relevant content.

### Current Problem
`extractWithDirective` in `sections/file-focus.ts` returns `{passages: [{text, match_reason?}]}`. These passages go to ALL sections as part of the source. Result: ICD suggester sees medication text and hallucinates diagnoses; medication section sees diagnostic text and includes wrong items.

### Solution

Extend `extractWithDirective` tool schema to return category per passage:

```typescript
interface ClassifiedPassage {
  text: string;
  match_reason?: string;
  category: "medication" | "diagnosis" | "finding" | "procedure" | "vital" | "history" | "general";
}
```

Then in `section-agent.ts`, filter file passages by relevance to the section's `kind`:

| Section kind | Sees categories |
|-------------|----------------|
| `medication-list` | `medication`, `general` |
| `conclusion` | `diagnosis`, `finding`, `general` |
| `exam-narrative` | `finding`, `vital`, `general` |
| `history-narrative` | `history`, `finding`, `diagnosis`, `general` |
| `vital-numeric` | `vital`, `general` |
| `default` | `general` + same-name match |

### Changes

**`web/src/lib/sections/file-focus.ts`:**
- Update tool schema to include `category` field on each passage
- Update prompt to instruct model to classify each passage
- Update server-side validation to check category is a valid enum value

**`web/src/lib/sections/section-agent.ts`:**
- Accept `kind` parameter (from `deriveKind`)
- Filter `files[].text` passages by category before building the source block
- ICD suggester also gets filtered: only `diagnosis`, `finding`, `history`, `general`

**`web/src/lib/sections/suggest-icd.ts`:**
- Filter input passages — exclude `medication`-only passages

**`web/src/lib/pipeline/session.ts`:**
- Pass classified passages through the pipeline
- Cache key in `file_focus_cache` must include the new category data

### Verification
- New eval fixture from the doctor feedback screenshot (wrong diagnosis from medication file)
- Existing evals still pass
- Manual test: upload a medication-only file with "zober len medikáciu" directive — verify ICD suggester doesn't hallucinate diagnoses from it

---

## Phase 5: Eval Harness Expansion

**Goal:** 10+ fixtures covering diverse error types observed in production.

### New Fixtures to Capture

| Source | Error Type | What to Test |
|--------|-----------|-------------|
| Doctor feedback (screenshot) | Wrong diagnosis from file | ICD suggester should not infer diagnosis from medication-only text |
| Doctor feedback | Generic drug name | Drug normalizer should preserve brand names from source |
| Doctor feedback | Therapy in wrong section | Section contracts should prevent cross-section leaking |
| Doctor feedback | Wrong acute diagnosis in Záver | Conclusion should prioritize specialty-relevant acute diagnosis first |
| Doctor feedback | Non-specialty diagnoses cluttering Záver | Conclusion should filter by specialty relevance per template contract |
| Production logs | Missing medication | LA completeness — critic should not strip chronic meds |
| Production logs | Invented vital value | Critic should catch numbers not in source |
| Edge case | Empty transcript + file only | Pipeline should work from file content alone |
| Edge case | Multiple files with conflicting info | Section should prefer more recent / more specific |
| Edge case | Záver with no diagnoses in source | Conclusion section should return empty string |

### Process
1. For each doctor-corrected encounter: export source + template + expected output as a fixture
2. Add to `web/src/lib/evals/fixtures/`
3. Register in `scripts/run-evals.ts`
4. Run full suite to establish new baseline

---

## Phase 6: A/B Test — Remove Skeleton

**Goal:** Determine if the `note-skeleton` (Sonnet extraction of key clinical entities before per-section rendering) is still needed once Sonnet handles rendering.

### Background
The skeleton call (`sections/note-skeleton.ts`) was added to help Haiku rendering by pre-extracting key entities (diagnoses, medications, procedures) from the transcript. With Sonnet now rendering narrative sections, this pre-extraction may be redundant — Sonnet can identify entities directly from the source.

### Approach
1. Add env flag `SKIP_SKELETON=1` to bypass the skeleton call
2. Run eval harness with and without skeleton
3. Compare: if scores are equal or better without skeleton, remove it
4. Saves one Sonnet call per generation (~$0.02-0.05 and 2-3s latency)

---

## Phase 7 (Future): Single-Call Generation

**Goal:** Replace per-section rendering with a single Sonnet/Opus call that generates the entire note holistically.

### Why Consider This
- **Cross-section coherence**: One model sees all sections together, naturally avoiding duplication
- **File routing solved implicitly**: Model decides where each piece of information belongs
- **Simpler architecture**: 1 call instead of N per-section calls
- **Latency**: One longer call vs N parallel shorter calls — may be faster overall

### Approach
1. Build as a parallel path, not a replacement
2. A/B test against per-section pipeline on eval harness
3. Keep per-section critics as post-processing (Haiku audits each section of the single-call output)
4. Template structure (headers, subheaders) passed as output schema to the single call

### Risks
- Loss of granular control per section
- Harder to debug which section went wrong
- May need Opus for longest notes (cost concern)
- Template changes require re-testing the whole output, not just one section

### Decision Gate
Only proceed if:
- Eval scores match or exceed per-section pipeline
- Cost per generation stays within 2x current
- Doctor feedback on quality is positive

---

## Implementation Order

```
Phase 1 (Model Tier Swap)         ← Do first, biggest quality win
    ↓
Phase 2 (Záver Normalization)     ← Depends on Phase 1 (Sonnet rendering for conclusion)
    ↓
Phase 3 (Rename Identifiers)      ← Quick cleanup after Phase 2 deletions
    ↓
Phase 4 (Passage Classification)  ← Fixes real doctor-reported bugs
    ↓
Phase 5 (Eval Expansion)          ← Should happen alongside Phases 2-4
    ↓
Phase 6 (Remove Skeleton A/B)     ← Only after Phase 1 is stable
    ↓
Phase 7 (Single-Call)             ← Future exploration, not committed
```

Phases 1-3 can ship together as one PR — the model swap enables Záver normalization, and renames clean up after deletions. Phase 4-5 are tightly coupled (need fixtures to verify classification). Phase 6 depends on Phase 1 being stable in production. Phase 7 is exploratory.
