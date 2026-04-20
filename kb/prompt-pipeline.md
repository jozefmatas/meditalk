# MediTalk Prompt Pipeline — Deep Dive

_Last updated: 2026-04-20 (Phase 1 safety: PHI scrub, medication normalization, assessment classifier, visit_date, defensive output scrub, section routing validator, richer fact extraction, TO/HPI routing)_

How raw clinical data becomes a structured medical note. This document covers every LLM call, the exact prompt texts, the deterministic filters between them, and cost/speed characteristics. For data intake (recording, transcription, file upload, doctor notes), see [data-extraction.md](data-extraction.md).

Read this before touching anything in [web/src/app/api/generate/route.ts](web/src/app/api/generate/route.ts), [web/src/app/api/regenerate/route.ts](web/src/app/api/regenerate/route.ts), [web/src/lib/clinical/](web/src/lib/clinical/), or [web/src/lib/anthropic.ts](web/src/lib/anthropic.ts).

---

## 0. Pipeline Overview

```
              INPUTS
               |
  transcript + files + doctor notes
               |
  Pass 1.1     scrubPhi                pure TS
               -> remove patient name, birth number, phone, email
               |
       ========|========  LLM CALLS (PARALLEL)  ========
               |                |                |
  Pass 1       | Sonnet 4.6    | Pass 1.5       | Embedding search
  Clinical     | (t=0, 4096)   | Haiku 4.5      | (legacy only)
  Analysis     |               | (t=0, 16384)   |
               |               |                |
               v               v                v
               |  15-category ExtractedFacts
               |
       ========|========  DETERMINISTIC GATES  ========
               |
  Pass 1.6a    validateFacts          pure TS
               -> drop ungrounded evidence, dedup, cross-source fallback
               -> medication base-name-only correction (preserves dose/freq)
               |
  Pass 1.6b    resolveFacts           pure TS
               -> drop self-corrected facts ("vlastne", ", nie,")
               |
  Pass 1.7     filterCertainIcdCandidates   pure TS
               -> drop ICD codes not lexically grounded in facts
               -> two-tier: broad (non-R) vs strict (R-chapter)
               -> synonym table bridges layperson<->medical terms
               |
  Pass 1.8     classifyAssessment     pure TS
               -> tier ICD candidates: active_current / chronic_relevant / background_only
               -> cap: 4 active + 5 chronic, background excluded
               |
  Pre-render   assignFactsToSections  pure TS
               -> deterministic fact-to-section mapping
               |
  Pre-render   buildPreRenderedIcdBlock  pure TS
               -> alphabetically sorted, VERBATIM copy contract
               |
       ========|========  LLM CALL  ========
               |
  Pass 2       Opus 4.6  (t=0)
  Generation   max_tokens: 8192
               -> JSON: one key per section (no title)
               |
       ========|========  POST-PROCESSING  ========
               |
  Pass A       stripBulletMarkers     pure TS
               -> strip "- ", "• ", etc. from line starts
               |
  Pass B       clearParentSections    pure TS
               -> force "" on sections with subsections
               |
  Pass C       enforceContentRouting  pure TS
               -> strip misrouted meds/substance/allergy content
               -> cross-section dedup (OA↔LA, SA↔Ab, EA↔AA)
               |
  Pass 2.1     scrubPhi (output)      pure TS
               -> defensive PHI scrub on generated section values
               |
  Pass 2.5     Defensive ICD filter    pure TS
               -> strip codes Opus snuck past the prompt
               |
  Title gen    Haiku 4.5  (t=0)       max_tokens: 64
               -> short title from extracted ICDs only
               |
               v
            PERSIST
```

**Key guarantees:**

1. **Every fact has verbatim evidence.** Pass 1.5 refuses to emit a fact without a quote; Pass 1.6a drops any fact whose quote isn't in the source.
2. **Every ICD code is grounded.** Pass 1.7 drops candidates that aren't lexically rooted in validated facts. Pass 1.8 classifies them by relevance tier and caps counts. Pass 2.5 defensively strips any Opus snuck past the prompt.
3. **Same inputs -> same outputs** for the entire post-Pass-1 pipeline. Pass 1 LLM noise is absorbed by deterministic downstream gates. ICD codes are pre-rendered in sorted order (VERBATIM copy), facts are pre-assigned to template sections, and transcript is omitted when facts are present — Opus acts as a formatter, not a reasoner.
4. **Template changes are lossless.** Validated facts are persisted in `metadata.validated_facts`. When the user changes templates, the regenerate route re-runs fact-to-section assignment against the new template (structured rerender) instead of prose reformatting.
5. **No PHI reaches LLMs.** Pass 1.1 (input scrub) removes patient name, birth number, phone, email from all source material before any LLM call. Pass 2.1 (output scrub) defensively re-applies the same scrub to generated sections.
6. **Medication dosages are never fabricated.** Pass 1.6a's medication auto-correction only replaces the base drug name (e.g. "Koprenesa" → "Co-Prenessa"), preserving the original dose/frequency verbatim. The full CSV product name is never injected.
7. **Temporal references resolve correctly.** `visit_date` from the DB is injected into both Haiku (Pass 1.5) and Opus (Pass 2) prompts as `ENCOUNTER DATE`, enabling "dnes"/"včera" resolution.

---

## 1. Templates

### 1.1 Shape

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

### 1.2 Resolution

`resolveTemplate(id)` in [web/src/lib/templates/index.ts](web/src/lib/templates/index.ts) looks up the DB first, then falls back to static defaults. A missing ID resolves to `DEFAULT_TEMPLATE_ID`.

### 1.3 Section contexts and labels

Two helpers flatten the hierarchy into what the prompt needs:

- `buildSectionLabelsFromTemplate(template, language)` -> `Record<sectionId, label>` used to render section headers in the final HTML.
- `buildSectionContextsFromTemplate(template, language)` -> `Record<sectionId, contextString>` for per-section guidance passed to Opus.

Section-specific guidance takes precedence over general rules per the system prompt instructions.

All 8 system templates have English `context` fields on every section and subsection (migration `20260416`). Contexts are consumed by the LLM, not shown to users — English is more token-efficient and language-agnostic. Example: `"Family history. Diseases of parents, siblings, grandparents. NEVER include the patient's own diseases here."`

---

## 1.5. Pass 1.1 — PHI Scrub (Input)

File: [web/src/lib/clinical/phi-scrubber.ts](web/src/lib/clinical/phi-scrubber.ts)
Integration: [web/src/app/api/generate/route.ts](web/src/app/api/generate/route.ts) — after file assembly, before any LLM call.

Deterministic regex-based removal of personally identifiable information from `transcriptText`, `fileTexts[].text`, and `doctorNotes`. Activated when `patient_name` or `patient_id` is set on the visit record.

**Scrubs:**

- Patient name (both orderings, case-insensitive) → `[PATIENT_NAME]`
- Birth number (rodné číslo: `YYMMDD/XXXX`, months 51-62 for females) → `[PATIENT_ID]`
- Phone numbers (SK/CZ: `+421`/`+420`, local `0XXX`) → `[PHONE]`
- Email addresses → `[EMAIL]`
- Long numeric IDs (9-12 digits, not already caught above) → `[PATIENT_ID]`
- Known patient ID string (exact match) → `[PATIENT_ID]`

**Preserves:** ages, clinical dates, ICD codes, blood pressure, medication dosages, clinical scores.

**Address scrubbing** detects Slovak/Czech postal code + city patterns (`821 03 Bratislava-Ružinov`) and street addresses with keyword prefixes (`ul. Hlavná 15`) or slash-notation house numbers (`Exnárova 3121/3`). Protections prevent false positives on:

- Blood pressure (`TK 150/95 mmHg`, `Krvný tlak 165/75`)
- All-caps clinical abbreviations ≤6 chars (`GCS 15/15`, `NIHSS 4/42`, `EKG 12/15`)
- Clinical measurement words (`Zornice 3/3`, `Zorničky 4/4`) via diacritics-normalized lookup
- Values followed by clinical units (`mmHg`, `bpm`, etc.)
- Values preceded by clinical keywords (`systol`, `diastol`, `pulz`, etc.)

**Audit trail:** `scrubPhi()` returns a `PhiAudit` object with `totalRedactions` and per-type `counts` (name, birthNumber, phone, email, address, numericId).

---

## 2. Pass 1 — Clinical Analysis

File: [web/src/lib/clinical/pipeline.ts:46](web/src/lib/clinical/pipeline.ts#L46)
Model: `claude-sonnet-4-6`, temperature 0, `max_tokens: 4096`

### 2.1 Why Sonnet not Haiku

Haiku 4.5 failed to distinguish anatomically-specific ICD codes (e.g. `I21.0` anterior wall vs `I21.2` other sites). Sonnet 4.6 reads the expanded 15-entries-per-category ICD reference reliably.

### 2.2 System prompt

Source: [web/src/lib/clinical/prompts.ts](web/src/lib/clinical/prompts.ts) — `buildPass1SystemPrompt()`

```
You are a clinical NLP pre-processor. Analyze a medical consultation transcript
and extract structured clinical information. Be precise and evidence-based — only
extract what is clearly stated or strongly implied.

INPUT LANGUAGE: The transcript is in {Slovak|Czech|English}. Clinical terms may
appear in any language.

TASK 1 — MATCH CLINICAL CONCEPTS:
Using the regional terms reference below to understand colloquial/abbreviated
terms, identify which clinical concepts are discussed in the transcript.
Regional terms: {regionalTermsRef}
Concept triggers: {conceptTriggersRef}
For each match, note a SHORT evidence snippet (max 10 words) and confidence.

TASK 2 — INFER SPECIALTY:
Based on matched concepts and overall content, choose the primary specialty from:
general_practice, internal_medicine, cardiology, pulmonology, gastroenterology,
neurology, orthopedics, dermatology, psychiatry, pediatrics, gynecology, urology,
endocrinology, oncology, ent.
If the consultation spans two specialties, also provide secondarySpecialty.

TASK 3 — CLUSTER PROBLEMS:
Group related concepts into problem clusters.

TASK 4 — SUGGEST ICD-10 CODES:
Based on matched concepts and clinical context, suggest candidate ICD-10 codes
from this reference:
{icdReference}  <-- 15 entries per ICD category, locale-specific
Select the most specific applicable codes. Include confidence level.

TASK 5 — EXTRACT MEDICATION NAMES:
List ALL medication/drug names mentioned in the transcript, exactly as spoken.

PER-FILE DIRECTIVES:
Individual files in the input may contain a line starting with "DOCTOR'S DIRECTIVE
FOR THIS FILE:". When present, this directive strictly limits what you may use
from that file. You MUST only consider the parts of the file that the directive
permits. Ignore all other content from that file for ALL tasks above.

OUTPUT: Return ONLY valid JSON, no markdown, no explanation.
```

### 2.3 User message

Source: [web/src/lib/clinical/prompts.ts](web/src/lib/clinical/prompts.ts) — `buildPass1UserMessage()`

```
Analyze this {Slovak|Czech|English} medical consultation transcript:

{transcriptText}

Return the structured JSON analysis.
```

**Note:** Pass 1 sees `clinicalInputParts` which includes both transcript chunks AND file texts (with per-file directives), joined with `\n\n`. This is constructed in [generate/route.ts](web/src/app/api/generate/route.ts) before being passed to `runClinicalAnalysis()`.

### 2.4 Output shape

```ts
interface ClinicalAnalysis {
  matchedConcepts: MatchedConcept[];
  inferredSpecialty: SpecialtyId;
  secondarySpecialty?: SpecialtyId;
  problemClusters: ProblemCluster[];
  candidateIcdCodes: CandidateIcdCode[];
  mentionedMedications: string[];
  usage: { inputTokens: number; outputTokens: number };
}
```

### 2.5 Supporting indexes

- **ICD index** — [icd-index.ts](web/src/lib/clinical/icd-index.ts). Loads the canonical ICD-10 CSV per locale; provides `buildIcdReferenceForConcepts` (15 entries per category), `resolveIcdCodes`, `extractIcdCodesFromSections`, `validateIcdDescriptions`.
- **Medication index** — [medication-index.ts](web/src/lib/clinical/medication-index.ts). Provides `searchMedications`, `isValidMedication`, `correctMedicationName` (fuzzy matching with Levenshtein distance).
- **Specialty prompts** — [specialty-prompts.ts](web/src/lib/clinical/specialty-prompts.ts). 14 specialty prompt packs, each with `systemPromptAddendum`, `emphasizedSections`, `terminologyNotes`.

### 2.6 Where it runs

In a three-way `Promise.all` with the (legacy) embedding search **and** Pass 1.5 (when `transcriptText` is available):

```ts
// When transcriptText exists, start fact extraction early in parallel
const earlyFactInput = transcriptText ? { chunks: [transcriptText], ... } : null;
const factExtractionPromise = earlyFactInput
  ? runFactExtraction(earlyFactInput, language, ctx).catch(() => null)
  : Promise.resolve(null);

const [embeddingResult, rawClinicalAnalysis, earlyRawFacts] =
  await Promise.all([embeddingPromise, clinicalPromise, factExtractionPromise]);
```

**Why this is safe:** Pass 1.5 doesn't depend on Pass 1 output — it reads raw sources. Pass 1 output is only used for ICD candidates and specialty, which are applied _after_ both complete. For legacy chunk-only encounters (no `transcriptText`), Pass 1.5 runs sequentially after Pass 1 as before.

---

## 3. Pass 1.5 — Structured Fact Extraction

File: [web/src/lib/clinical/fact-extraction.ts](web/src/lib/clinical/fact-extraction.ts)
Model: `claude-haiku-4-5-20251001`, temperature 0, `max_tokens: 16384`

### 3.1 Why this pass exists

Pass 2 (Opus) is much more grounded when it sees a terse, category-bucketed list of facts with verbatim evidence. Instead of asking Opus to both interpret the transcript _and_ write prose, we turn the transcript into a structured contract first and then tell Opus _"these facts are the truth; do not go beyond them."_

### 3.2 System prompt

Source: [web/src/lib/clinical/fact-extraction.ts:141](web/src/lib/clinical/fact-extraction.ts#L141) — `buildFactExtractionSystemPrompt()`

```
You are a clinical fact extractor. Your ONLY job is to extract facts that are
EXPLICITLY stated in the source material and return them as structured JSON.

RULES:
1. Extract ONLY facts that are directly stated in the source. No inference, no
   assumptions, no "commonly associated" findings.
2. Every fact MUST include a source reference with a short VERBATIM evidence quote
   (<=120 chars) copied from the source material. Quote the exact wording.
3. If you cannot find evidence for a fact, do NOT include it.
4. Do NOT interpret, diagnose, or upgrade severity. If the source says "ACS",
   the diagnosis stays "ACS" — never rewrite to "STEMI" or "non-STEMI".
5. For medications: extract the exact name as mentioned. Include dosage only if
   EXPLICITLY stated.
6. For diagnoses: copy the exact wording. Preserve uncertainty markers.
7. For measurements: always include the unit as stated — and ONLY the unit as
   stated.
8. Facts describing what the doctor PLANS to do go in `plan`.
9. HISTORY SUBCATEGORY ROUTING — use the CORRECT subcategory:
   - familyHistory: diseases of parents, siblings, grandparents. NEVER patient's own.
   - personalHistory: patient's OWN past conditions.
   - socialHistory: marital status, housing. NEVER substance use, NEVER work.
   - workHistory: occupation, workplace exposures. NEVER smoking/alcohol.
   - substanceUse: smoking, alcohol, drugs. NEVER in workHistory or socialHistory.
   - epidemiologicalHistory: travel, infections, tick bites, vaccinations.
10. Write fact `value` fields in {language}. Per-category char limits:
    chiefComplaint ≤400, findings ≤250, all others ≤120.
11. A single source statement may produce multiple facts, but the same fact MUST
    NOT appear in more than one category.
12. EXTRACT EVERY DISTINCT MENTION — do NOT try to resolve self-corrections
    yourself. If the speaker corrects themselves, emit BOTH mentions as separate
    facts. A deterministic downstream step (Pass 1.6b) will handle it.
13. NO ASSUMPTION MODE — NEVER invent missing clinical dimensions. If a numeric
    value is stated WITHOUT a unit ("fajci 15" with no "cigariet/den"), preserve
    the raw value and mark as "(jednotka nespecifikovana)".

SOURCE REFERENCE SCHEMA:
- type: "transcript" | "doctor_notes" | "file"
- sourceIndex: integer (0-based, from the header label)
- evidence: short verbatim quote (<=120 chars)

CATEGORIES: demographics, chiefComplaint, symptoms, findings, measurements,
diagnoses, medications, procedures, familyHistory, personalHistory, socialHistory,
workHistory, substanceUse, epidemiologicalHistory, plan
```

### 3.3 User message

Source: [web/src/lib/clinical/fact-extraction.ts:211](web/src/lib/clinical/fact-extraction.ts#L211) — `buildFactExtractionUserMessage()`

```
TRANSCRIPT CHUNKS:

[transcript sourceIndex=0]:
{chunk text}

UPLOADED FILE CONTENTS:

[file sourceIndex=0 name="labs.pdf" type="application/pdf"]:
DOCTOR'S DIRECTIVE FOR THIS FILE: {context, if present}
{extracted text}

DOCTOR'S NOTES [doctor_notes sourceIndex=0]:
{doctor notes}

Extract every clinical fact that is EXPLICITLY stated in the source material
above. Return a single JSON object with the exact category keys listed in the
system prompt. Every fact MUST include a verbatim evidence quote. IMPORTANT: If
the DOCTOR'S NOTES contain explicit instructions to only use certain parts of
uploaded files, respect those instructions. EQUALLY IMPORTANT: If a file section
contains a line starting with 'DOCTOR'S DIRECTIVE FOR THIS FILE:', that directive
OVERRIDES what you extract from that specific file.
```

**visit_date injection:** When `visit_date` is set on the visit record, the user message is prepended with `ENCOUNTER DATE: DD.M.YYYY` and an instruction to resolve "dnes"/"včera"/"today"/"yesterday" relative to this date. The same injection is applied to the Opus (Pass 2) user message via `buildTemplateUserMessage`.

### 3.4 Output — `ExtractedFacts`

Fifteen fixed categories, all arrays of `ExtractedFact`:

```
demographics, chiefComplaint, symptoms, findings, measurements,
diagnoses, medications, procedures,
familyHistory, personalHistory, socialHistory, workHistory,
substanceUse, epidemiologicalHistory, plan
```

```ts
interface ExtractedFact {
  category: FactCategory;
  value: string; // <=120 chars, clinical phrasing
  source: {
    type: "transcript" | "doctor_notes" | "file";
    sourceIndex: number;
    evidence: string; // <=120 chars verbatim quote
  };
}
```

---

## 4. Pass 1.6a — Fact Validation

File: [web/src/lib/clinical/fact-validator.ts](web/src/lib/clinical/fact-validator.ts)
Pure TypeScript. No LLM call.

For every fact, check that `evidence` actually appears in the source it claims to come from:

1. **Normalize** both sides via `normalizeForMatch` — Unicode NFKD, strip combining marks, lowercase, collapse non-alphanumerics to spaces. Locale-agnostic (`sk`/`cs`/`en`).
2. **First pass:** normalized evidence as substring of normalized source?
3. **Second pass:** all content tokens (>=3 chars) in order?
4. **Cross-source fallback:** if the claimed source doesn't match, try every other source (rescues Haiku mislabeling `transcript` vs `file`). On success, updates the fact's source reference.

Removal reasons: `evidence_not_in_source`, `source_index_out_of_range`, `duplicate`, `empty_value`.

**Medication auto-correction (base-name-only):** Validates against the approved list via `isValidMedication`. On miss, `correctMedicationBaseName` attempts fuzzy matching (Levenshtein >= 0.7). The key invariant: only the drug **name** is corrected — dose, frequency, and route are preserved verbatim from the source via `parseMedicationFact` / `reconstructMedicationValue` ([web/src/lib/clinical/medication-normalizer.ts](web/src/lib/clinical/medication-normalizer.ts)). This prevents the dosage fabrication bug where the full CSV product name (e.g. "Eliquis 2,5 mg filmom obalene tablety") replaced the entire fact value.

**Medication block in enriched prompt:** When `hasValidatedFacts` is true, the separate medication resolution block in `buildEnrichedSystemPrompt` is skipped entirely. Facts are the single source of truth — no dual medication list conflict.

---

## 5. Pass 1.6b — Fact Resolution (Correction Detection)

File: [web/src/lib/clinical/fact-resolver.ts](web/src/lib/clinical/fact-resolver.ts)
Pure TypeScript. No LLM call.

Drops facts that were replaced by the speaker. Rule-based, 100% deterministic.

**Detection:** For each fact, find its evidence quote in the source and look ahead ~120 chars for either:

- A curated **correction phrase** per locale:
  - Slovak: `vlastne`, `pardon`, `prepacte`, `nie skor`, `myslel som`, `opravujem sa`, ...
  - Czech: `vlastne`, `pardon`, `prominte`, `ne spise`, `chtel jsem rict`, ...
  - English: `actually`, `sorry`, `i mean`, `no wait`, `scratch that`, `my mistake`, ...
- A **punctuation-bracketed negation** matched by regex: `/[,;.:—-]\s*(nie|ne|nein|non|nej|neni|nicht|ikke|inte|nix|niet)\s*[,;.:—-]/iu`

**Important:** English `no` is **excluded** from the regex because Slovak `no` means "well/so" (filler word, extremely common in clinical speech). English corrections like "no wait" / "wait no" are covered by the phrase-based detection.

**What it does NOT do:** numeric last-mention-wins deduplication. That rule wrongly collapsed legitimate time-series (multiple BP readings at different times).

---

## 6. Pass 1.7 — ICD Certainty Filter

File: [web/src/lib/clinical/icd-certainty.ts](web/src/lib/clinical/icd-certainty.ts)
Pure TypeScript. No LLM call.

### 6.1 Problem it solves

Pass 1 (Sonnet 4.6 at temperature 0) is NOT strictly deterministic. Its prompt allows ICD codes "based on clinical context," which means labs and symptoms can promote a related code into the candidate list even when the doctor never diagnosed that condition.

### 6.2 Two-tier grounding

**Non-R codes (disease codes — I, E, J, K, ...):** Broad grounding. ALL fact categories contribute EXCEPT `demographics` and `measurements`:

```ts
[
  diagnoses,
  chiefComplaint,
  symptoms,
  findings,
  medications,
  procedures,
  plan,
  familyHistory,
  personalHistory,
  socialHistory,
  workHistory,
  substanceUse,
  epidemiologicalHistory,
];
```

**R-chapter codes (symptom/sign codes R00-R99):** Strict grounding. Only `diagnoses` + history subcategories. This prevents "chest pain" (symptom fact) from promoting R07.2 while allowing it to promote I21.4 (disease code).

### 6.3 Three matching checks

A candidate ICD code is **certain** iff at least one passes:

1. **Direct code match:** The literal ICD code string (e.g. `"I10"`) appears in any grounding fact value. Doctors often dictate codes directly.
2. **Stem match:** Tokens are extracted (drop stop words, drop <4 char tokens except clinical abbreviations like `IM`, `DM`, `HT`, `COPD`, `STEMI`), truncated to 6-char stems (`hypertenzia` -> `hypert`), and checked bidirectionally (fact->ICD AND ICD->fact).
3. **Synonym match:** If a stemmed token has entries in the clinical synonym table, those synonym stems are tested too.

### 6.4 Clinical synonym table

```
| Group          | Stems                      | Bridges                                 |
| Blood pressure | tlak, hypert, tenzie       | krvny tlak <-> hypertenzia/hypertension  |
| Diabetes       | cukrov, diabet             | cukrovka <-> diabetes mellitus           |
| MI             | zaval, infark              | srdcovy zaval <-> infarkt myokardu       |
| Stroke         | mrtvic, porazk             | mrtvica/porazka <-> CMP                  |
| Asthma         | astma, asthma              | astma (SK/CZ) <-> asthma (EN)           |
```

### 6.5 Suggested vs. certain ICD codes

The generate route preserves ALL pre-filter candidates as `suggestedIcdCodes` in metadata. The ICD panel UI shows suggestions so the doctor sees all candidates, not just the certain ones in the note.

### 6.6 Empty-list behavior

When all candidates are dropped, `buildEnrichedSystemPrompt` adds an explicit "NO ICD CODES" instruction telling Opus to not include ANY ICD codes — preventing hallucinated codes.

---

## 6.5. Pass 1.8 — Assessment Relevance Classification

File: [web/src/lib/clinical/assessment-classifier.ts](web/src/lib/clinical/assessment-classifier.ts)
Integration: [web/src/app/api/generate/route.ts](web/src/app/api/generate/route.ts) — after ICD certainty filter.
Pure TypeScript. No LLM call.

Classifies ICD candidates that passed the certainty filter into three tiers based on which fact categories ground them:

| Tier               | Grounding categories                          | Cap      |
| ------------------ | --------------------------------------------- | -------- |
| `active_current`   | diagnoses, chiefComplaint, symptoms, findings | max 4    |
| `chronic_relevant` | personalHistory, medications                  | max 5    |
| `background_only`  | everything else                               | excluded |

Overflow from active cap rolls into chronic. Background candidates are excluded from the Opus prompt entirely — they only appeared in the old history sections (OA) if placed there by Haiku facts.

This eliminates the encyclopedic diagnosis dumps in Záver that doctors complained about.

---

## 7. Fact-to-Section Assignment

File: [web/src/lib/clinical/fact-section-assigner.ts](web/src/lib/clinical/fact-section-assigner.ts)
Pure TypeScript. No LLM call.

Before facts reach Opus, this module assigns each fact to a concrete template section ID. This removes one of the largest sources of cross-run variance: Opus no longer decides where facts go.

**Matching strategy:**

1. Check `sectionContexts` for category keywords (substring match)
2. Check `sectionLabels` for abbreviation/name matches (exact match for short abbreviations like `ra`, `oa`, `sa`, `pa` to avoid `pa` matching `patient`)
3. Unmatched facts go to `_unassigned`

**Category -> keyword patterns (from `CATEGORY_SECTION_PATTERNS`):**

```
demographics  -> demograf, demographic, udaje o pacient
chiefComplaint -> dovod, reason, chief complaint, to, terajsie, hpi, present illness, dovod kontakt
symptoms      -> symptom, priznak, complaints, to, terajsie
findings      -> nalez, finding, status praesens, physical exam
measurements  -> meranie, measurement, vital, laborator
diagnoses     -> diagnoz, zaver, assessment, conclusion
medications   -> liek, medic, farmak, meds, la
procedures    -> vykon, procedur, zakrok, surgery
familyHistory -> rodinn, family, ra
personalHistory -> osobn, personal, oa, past medical
socialHistory -> socialn, social, sa, byvanie
workHistory   -> pracovn, work, occupat, pa
substanceUse  -> abuz, substance, fajcen, alkohol, ab, smoking
epidemiologicalHistory -> epidemiolog, ea, cestovan, travel
plan          -> plan, odporuc, recommendation, terapia, liecba
```

**Output format for the prompt:**

```
[Section "RA" (s_ra)]:
  - [Family History] otec zomrel na IM v 65 rokoch
  - [Family History] matka DM 2. typu

[Section "OA" (s_oa)]:
  - [Personal History] st.p. CABG 2019
```

---

## 8. Prompt Assembly for Pass 2

### 8.1 Two system prompts

Source: [web/src/lib/anthropic.ts](web/src/lib/anthropic.ts)

There are now **two** system prompt builders. The pipeline chooses based on whether validated facts are present:

```ts
const hasValidatedFacts = !!(validatedFacts && countFacts(validatedFacts) > 0);
let systemPrompt = hasValidatedFacts
  ? buildFactBasedSystemPrompt(
      template,
      language,
      sectionLabels,
      sectionContexts,
    )
  : buildTemplateSystemPrompt(
      template,
      language,
      sectionLabels,
      sectionContexts,
    );
```

#### `buildFactBasedSystemPrompt()` — lean prompt for the facts-present path

Source: [web/src/lib/anthropic.ts:88](web/src/lib/anthropic.ts#L88)

~60% shorter than the full prompt. Removes rules already enforced by upstream deterministic gates:

- **Removed:** Insufficient context check (impossible when validated facts exist)
- **Removed:** Verbose grounding / NO ASSUMPTION MODE (enforced by Pass 1.5 rules)
- **Removed:** Source priority hierarchy (facts are the single source of truth)
- **Removed:** Title key from JSON output (title generated exclusively by dedicated Haiku call)
- **Removed:** Section routing rules 8a-8h (facts already pre-assigned to sections)

**Keeps:** FACT VALUE FIDELITY (primary rule), condensed NEVER FABRICATE, directives, output language, formatting, JSON format, style guide.

Falls through to the full `buildTemplateSystemPrompt` when the template uses a custom `systemPrompt` — custom prompts bypass this optimisation.

```
You are a medical documentation assistant. You MUST follow these rules strictly:

CRITICAL — SECTION-SPECIFIC GUIDANCE OVERRIDES ALL: ...

1. FACT VALUE FIDELITY: The pre-assigned validated clinical facts are the sole
   source of clinical truth. Your job is to FORMAT them into the note, not to
   REWRITE them.
   - Reproduce each fact's wording as closely as possible.
   - Do NOT rephrase, paraphrase, elaborate, summarize, or add context.
   - Do NOT merge multiple facts into compound sentences.
   - Present facts in the EXACT order they appear in the input.
   - If a section has pre-assigned facts, derive content exclusively from them.
   - The same facts must produce the same output text every time.

2. NEVER FABRICATE MISSING CLINICAL DIMENSIONS: ...
3. DIRECTIVES: Doctor's notes and per-file directives are authoritative.
4. OUTPUT LANGUAGE: Write ALL content in {language}.
5. MISSING SECTIONS: Output empty string "".
6. FORMATTING — NO BULLET POINTS: Never use bullet markers (-, •, *, –, —). Diagnoses one per line (code + name, no prefix). Medications comma-separated inline. History/exam as flowing prose.
7. PARENT SECTIONS WITH SUBSECTIONS: Parent section = "" — content in subsections only (e.g. Anamnézy parent is empty, content goes into RA, OA, SA, etc.).
8. FORMAT: Return valid JSON with section keys only. No "title" key.
9. ASSESSMENT SCOPE: Záver must be concise — max 4 active + 5 chronic ICD items.
10. HISTORY COMPRESSION: OA/RA/SA/PA/Ab — compact flowing prose, comma/semicolon-separated.

TEMPLATE SECTIONS:
{sections}
{styleGuide}
```

#### `buildTemplateSystemPrompt()` — full prompt for legacy path

Source: [web/src/lib/anthropic.ts:166](web/src/lib/anthropic.ts#L166)

Used when validated facts are NOT available. Contains all rules including:

- Insufficient context check
- NO ASSUMPTION MODE
- Source priority hierarchy
- FACT VALUE FIDELITY (conditional on facts being present)
- Section routing rules (9a-9h)
- Assessment scope constraints (rule 10)
- History compression constraints (rule 11)
- No-bullet formatting (rule 6) and parent-section-empty rule (rule 7)

**Note:** Title is NOT generated by Pass 2 in either prompt path. Title generation is handled exclusively by the dedicated Haiku call (§10).

Full prompt text unchanged from before — see `buildTemplateSystemPrompt()` in source.

### 8.2 Enriched system prompt

Source: [web/src/lib/clinical/pipeline.ts:137](web/src/lib/clinical/pipeline.ts#L137) — `buildEnrichedSystemPrompt()`

The base gets augmented with four blocks. The function now accepts a `hasValidatedFacts` flag which controls the verbosity of certain blocks:

**1. Specialty prompt pack** (from [specialty-prompts.ts](web/src/lib/clinical/specialty-prompts.ts)):

```
{pack.systemPromptAddendum}
TERMINOLOGY: {pack.terminologyNotes}
EMPHASIZED SECTIONS: {pack.emphasizedSections}
```

When the template declares a `specialties` field, the template specialty overrides Pass 1's `inferredSpecialty`.

**2. Medication verification block** — two modes:

When `hasValidatedFacts` is **false** (full verbose rules):

```
VERIFIED MEDICATIONS FROM APPROVED LIST (locale: sk):
  Co-Prenessa 8 mg/2,5 mg (perindopril/indapamid)
  Tamurox 0,4 mg (tamsulosin)
RULES:
- Only include medications EXPLICITLY mentioned
- Use EXACT names from the VERIFIED list
- If marked [corrected from "..."], use the CORRECTED name
- If marked [not found in approved list], use EXACTLY the dictated name
```

When `hasValidatedFacts` is **true** (condensed — FACT VALUE FIDELITY already constrains the LLM):

```
VERIFIED MEDICATIONS (locale: sk):
  Co-Prenessa 8 mg/2,5 mg (perindopril/indapamid)
  Tamurox 0,4 mg (tamsulosin)
Use corrected names where marked [corrected from "..."]. For [not found in
approved list], use the dictated name without annotations.
```

**3. ICD-10 BLOCK (VERBATIM)** — when candidates exist:

```
ICD-10 BLOCK (VERBATIM) — Copy the following block EXACTLY as-is into the
Zaver/Assessment section. The Zaver/Assessment section MUST contain ONLY these
ICD-10 code lines — no additional narrative text. Do NOT reorder, add, remove,
rephrase, or modify any line. Do NOT add any other ICD codes. Every code below
has been validated by a deterministic certainty filter — codes not in this list
MUST NOT appear anywhere in your output:
- I10 Esencialna (primarna) hypertenzia
- I21.4 Akutny subendokardialny infarkt myokardu
```

When the candidate list is **empty** (all dropped by certainty filter):

```
ICD-10 CODES: No ICD-10 codes were identified with sufficient certainty for
this encounter. Do NOT include ANY ICD-10 codes in your output. Do NOT invent,
guess, or add ICD codes based on clinical context.
```

**4. Clinical concepts and problem clusters** — **omitted when `hasValidatedFacts` is true:**

These are advisory metadata useful for the grounding path but add unnecessary prompt tokens when the LLM is doing a pure formatting task over pre-assigned facts.

```
IDENTIFIED CLINICAL CONCEPTS:
  - Hypertension (high)
  - Acute coronary syndrome (high)

PROBLEM CLUSTERS:
  - Cardiovascular risk: hypertension, dyslipidemia
```

### 8.3 User message

Source: [web/src/lib/anthropic.ts:171](web/src/lib/anthropic.ts#L171) — `buildTemplateUserMessage()`

Block order:

**1. VALIDATED CLINICAL FACTS — PRE-ASSIGNED TO SECTIONS:**

```
VALIDATED CLINICAL FACTS — PRE-ASSIGNED TO SECTIONS:
RULES:
1. Place ONLY the listed facts into each section — do NOT move facts between sections.
2. Do NOT introduce clinical details, context, or information not in this list.
3. Preserve each fact's wording as closely as possible — only adjust grammar minimally.
4. Present facts in the EXACT order shown below within each section. Do NOT reorder.
5. Each fact = one distinct statement on its own line. No bullet markers. Do NOT merge facts.

[Section "RA" (s_ra)]:
  - [Family History] otec zomrel na IM v 65 rokoch
  - [Family History] matka DM 2. typu

[Section "OA" (s_oa)]:
  - [Personal History] st.p. CABG 2019
  - [Personal History] arteriova hypertenzia
```

**2. TRANSCRIPT CHUNKS** — **Omitted when validated facts are present.** Only included in legacy no-facts path.

**3. UPLOADED FILE CONTENTS** — numbered extracted texts with per-file directives:

```
UPLOADED FILE CONTENTS:

[File 1: sono_report.pdf]:
DOCTOR'S DIRECTIVE FOR THIS FILE: Pouzi len echokg a poslednu liecbu
{extracted text}
```

**4. DOCTOR'S ADDITIONAL NOTES** — verbatim.

**5. Final instruction:**

```
Fill in each template section based ONLY on the information above. Return valid
JSON with keys: "s_to", "s_oa", "s_ra", ...
```

---

## 9. Pass 2 — Generation

File: [web/src/lib/anthropic.ts:387](web/src/lib/anthropic.ts#L387) — `generateFromTemplate()`
Model: `claude-opus-4-6`, temperature 0, `max_tokens: 8192`

**Fallback chain:** Opus 4.6 -> Sonnet 4.6 -> Sonnet 4.5 -> Sonnet 4.20250514
**Fallback delay:** 2000ms between attempts

The model streams JSON via SSE. `extractSectionsFromStream` scans for closing brackets of each known key and emits `section` events to the client progressively.

### 9.1 Post-processing

After Opus returns:

1. **Pass A — Bullet stripping** — `stripBulletMarkers()` defensively removes leading `- `, `• `, `* `, `– `, `— ` from all lines in every section value. The model frequently ignores no-bullet prompt instructions, so this guarantees clean output regardless of model compliance.
2. **Pass B — Parent section clearing** — `collectParentSectionIds()` identifies template sections with subsections (e.g. Anamnézy with RA, OA, SA...) and forces their content to `""`. All content must live in subsections only.
3. **Pass C — Section routing validator** — `enforceContentRouting()` ([section-routing-validator.ts](web/src/lib/clinical/section-routing-validator.ts)) deterministically strips misrouted content from sections. Only runs when `hasValidatedFacts` is true. Six rules:
   - **Rule 1:** Medication blocks (3+ consecutive dosage lines, or header + 2+) stripped from non-LA, non-plan sections. Preserves narrative medication mentions with historical context (e.g. "v minulosti užíval Warfarin, vysadený pre krvácanie").
   - **Rule 2:** Substance use content (fajčí, alkohol, drogy, etc.) stripped from non-Ab sections.
   - **Rule 3:** Allergy content (alergie, precitlivelosť, etc.) stripped from non-AA sections.
   - **Rule 4:** Cross-section dedup OA↔LA — identical non-trivial lines (>20 chars) appearing in both are stripped from OA, kept in LA.
   - **Rule 5:** Cross-section dedup SA↔Ab — identical lines stripped from SA, kept in Ab.
   - **Rule 6:** Cross-section dedup EA↔AA — identical lines stripped from EA, kept in AA.
   Section classification uses `ABBREVIATION_ROLE_MAP` (exact label match: la→medications, ab→substanceUse, aa→allergies, ea→epidemiological, oa→personalHistory, sa→socialHistory) and `ROLE_PATTERNS` (substring match on label/context).
4. **ICD description validation** — `validateIcdDescriptions()` replaces any hallucinated/paraphrased ICD descriptions with exact canonical CSV text. **Skipped when `hasValidatedFacts` is true** — the ICD block was pre-rendered by `buildPreRenderedIcdBlock` and the doctor's original wording is preserved.
4. **Pass 2.1 — Defensive PHI scrub** — re-applies `scrubPhi()` to each generated section value. Even though input was scrubbed (Pass 1.1), the LLM might reconstruct PHI from partial clues. The PHI scrubber now protects blood pressure values from false-positive address matching (e.g. "Tlak 138/84 mmHg" was being matched by `STREET_SLASH_HOUSE_REGEX`).
5. **ICD code extraction** — `extractIcdCodesFromSections()` scans generated text for `CODE Description` lines (no bullet prefix required — regex uses optional bullet marker).
6. **Pass 2.5 defensive filter** — intersects extracted codes with the pre-filtered candidate set. Strips unauthorized codes from both the sidebar list AND the section text.
7. **HTML rendering** — `buildTemplateHtml()` wraps section contents into the template HTML structure.

---

## 10. Title Generation

File: [web/src/lib/anthropic.ts:339](web/src/lib/anthropic.ts#L339) — `generateEncounterTitle()`
Model: `claude-haiku-4-5-20251001`, temperature 0, `max_tokens: 64`

Dedicated call whose ONLY input is the extracted ICD codes. No transcript, no doctor notes — eliminates hallucinated title details.

```
System: You write concise encounter titles for medical notes.
STRICT RULES:
1. Output ONLY the title text — no JSON, no quotes, no explanations.
2. Maximum 6 words.
3. Write in {language}.
4. Base the title ONLY on the diagnosis descriptions provided. Do NOT add any
   clinical detail not present in the primary diagnosis description.
5. Use the FIRST (primary) diagnosis as the basis. Ignore symptom codes (R00-R99).
6. Do NOT include the ICD code itself in the title.

User: DIAGNOSES (primary first):
I21.4 Akutny subendokardialny infarkt myokardu
I10 Esencialna (primarna) hypertenzia

Output only the title, nothing else.
```

---

## 11. Regenerate — Three Paths

File: [web/src/app/api/regenerate/route.ts](web/src/app/api/regenerate/route.ts)

The regenerate route tracks its execution path via `operationType: "regenerate" | "rerender" | "reformat"` for usage logging and audit.

### 11.1 Structured rerender (preferred)

**Condition:** Template change + cached `validated_facts` in metadata.

Uses cached validated facts from the original generation (persisted in `metadata.validated_facts`) to re-render the note for the new template layout. This is more reliable than prose reformatting because it runs the same fact-to-section assignment pipeline:

1. Load `validatedFacts` from metadata
2. `assignFactsToSections()` with the **new** template's section labels/contexts
3. `buildFactBasedSystemPrompt()` (lean prompt)
4. `buildEnrichedSystemPrompt()` with `hasValidatedFacts: true`
5. `buildTemplateUserMessage()` with facts — same as initial generation
6. Generate via Opus (same fallback chain)

**Does NOT re-run:** Pass 1, Pass 1.5, Pass 1.6a/b, Pass 1.7 — these only need to run once since facts and ICD codes are cached.

### 11.2 Legacy reformat (fallback)

**Condition:** Template change but NO cached `validated_facts` (old encounters generated before the fact pipeline existed).

Uses the **same model fallback chain** (Opus -> Sonnet) to reformat the existing note prose into the new template layout. Doesn't re-run Pass 1 / Pass 1.5. Reuses existing title.

The reformat prompt is simple:

```
System: You reorganize medical documentation between template formats.
Rules:
1. Preserve ALL clinical information.
2. Preserve the EXACT tone, voice, and writing style of the original note.
3. Write in {language}.
4. Empty sections: use "".
5. Follow section Context instructions carefully.
6. Return valid JSON.

User: CURRENT NOTE SECTIONS:
[s_to]: {content}
[s_oa]: {content}
...

Reorganize into these target template sections:
- "s_to": Terajsie ochorenie
- "s_oa": Osobna anamneza
...

Return valid JSON.
```

### 11.3 Full path

Identical pipeline to `/api/generate`. Optionally reuses cached `clinical_analysis` from metadata to skip Pass 1. Always runs Pass 1.5 through Pass 2.5. Now also uses `buildFactBasedSystemPrompt` when validated facts are present.

---

## 12. Cost & Speed Analysis

### 12.1 Model pricing

Source: [web/src/lib/usage.ts](web/src/lib/usage.ts)

| Model                        | Input ($/1M tokens) | Output ($/1M tokens) | Used in                                          |
| ---------------------------- | ------------------- | -------------------- | ------------------------------------------------ |
| `claude-opus-4-6`            | $15.00              | $75.00               | Pass 2 (generation)                              |
| `claude-sonnet-4-6`          | $3.00               | $15.00               | Pass 1 (analysis), File OCR, fallback generation |
| `claude-sonnet-4-5-20250929` | $3.00               | $15.00               | Fallback 2                                       |
| `claude-haiku-4-5-20251001`  | $1.00               | $5.00                | Pass 1.5 (facts), title generation               |
| `text-embedding-ada-002`     | $0.10               | $0.00                | Legacy embedding search                          |
| Scribe v2 (ElevenLabs)       | $0.40/hour          |                      | Transcription                                    |

### 12.2 Per-encounter cost breakdown (typical cardiology encounter)

Assuming ~5min consultation, 1 uploaded PDF, generating in Slovak:

| Stage                      | Model      | Est. input tokens | Est. output tokens | Est. cost  |
| -------------------------- | ---------- | ----------------- | ------------------ | ---------- |
| Transcription              | Scribe v2  | —                 | —                  | ~$0.03     |
| File OCR (PDF)             | Sonnet 4.6 | ~2,000            | ~1,500             | ~$0.03     |
| Pass 1 — Clinical analysis | Sonnet 4.6 | ~8,000            | ~800               | ~$0.04     |
| Pass 1.5 — Fact extraction | Haiku 4.5  | ~6,000            | ~3,000             | ~$0.02     |
| Pass 1.6a/b, 1.7           | Pure TS    | —                 | —                  | $0.00      |
| Pass 2 — Generation        | Opus 4.6   | ~6,000            | ~3,000             | ~$0.32     |
| Title generation           | Haiku 4.5  | ~200              | ~20                | ~$0.00     |
| **Total**                  |            |                   |                    | **~$0.44** |

**Opus dominates cost** at ~73% of the total. Everything else combined is ~$0.12.

### 12.3 Pipeline timing

```
                   0s        5s        10s       15s       20s       25s
                   |---------|---------|---------|---------|---------|
Transcription      |=========|                                        ~3-8s
File OCR                     |===|                                    ~2-4s
                             \--- runs in parallel ---/
Pass 1 (Sonnet)    |=========|                                        ~3-6s
Pass 1.5 (Haiku)   |==========|  (parallel with Pass 1)              ~4-8s
Embedding search   |=|           (parallel with both)                 ~1-2s
Pass 1.6a/b, 1.7              |=|                                    <100ms
Fact assignment                 |                                     <10ms
Pass 2 (Opus)                   |================|                   ~10-25s
Pass 2.5 + title                                  |=|                ~1-2s
                   |---------|---------|---------|---------|---------|
                   0s        5s        10s       15s       20s       25s
```

**Key parallelism in the current pipeline:**

- **Three-way `Promise.all`:** Pass 1 (Sonnet) + Pass 1.5 (Haiku) + legacy embedding search — all run concurrently when `transcriptText` is available. Saves ~4-8s wall time compared to serial execution.
- For legacy chunk-only encounters (no `transcriptText`), Pass 1.5 runs sequentially after Pass 1
- File extractions run in parallel with each other
- Transcription happens client-side before the generate call

**Total wall time:** ~12-30s depending on transcript length and model load

### 12.4 Optimization opportunities

#### Speed optimizations

| Idea                                  | Savings                  | Complexity | Trade-off                                                                                                                                                                                                          |
| ------------------------------------- | ------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ~~Run Pass 1 + Pass 1.5 in parallel~~ | ~~~4-8s~~                | ~~Done~~   | **Implemented.** Three-way `Promise.all` when `transcriptText` available. See §2.6.                                                                                                                                |
| **Cache Pass 1 by input hash**        | Skip ~3-6s on regenerate | Low        | Already partially done (cached `clinical_analysis` in metadata). Could content-address by transcript+files hash to skip the Sonnet call entirely on regenerate.                                                    |
| **Stream Pass 2 start earlier**       | Perceived ~5s faster     | Low        | Start streaming Opus while Pass 1.7 is still running. The system prompt can be built incrementally — specialty and concepts are available from Pass 1, ICD block can be injected as a late user-message amendment. |
| **Replace Opus with Sonnet 4.6**      | ~5-10s faster generation | Low        | Sonnet is 3-5x faster than Opus. Quality trade-off needs testing — Opus handles multi-section structured generation more reliably.                                                                                 |

#### Cost optimizations

| Idea                                            | Savings                                | Complexity | Trade-off                                                                                                                                                          |
| ----------------------------------------------- | -------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Replace Opus with Sonnet 4.6 for generation** | ~75% of Pass 2 cost (~$0.24/encounter) | Low        | Sonnet 4.6 is 5x cheaper on input, 5x cheaper on output. Quality trade-off: Opus produces better-structured, more natural Slovak medical prose. Could A/B test.    |
| ~~Prompt compression~~                          | ~~~10-20% of Pass 2 cost~~             | ~~Done~~   | **Implemented.** `buildFactBasedSystemPrompt` is ~60% shorter for the facts-present path. See §8.1.                                                                |
| **Skip Pass 1 when facts are sufficient**       | ~$0.04/encounter                       | Medium     | If Pass 1.5 extracts enough facts for the note, Pass 1's concepts/specialty/ICD hints become less critical. Could make Pass 1 conditional on encounter complexity. |
| **Shorter fact evidence quotes**                | ~15% of Pass 1.5 input tokens          | Low        | Currently 120-char max. Could reduce to 80 chars. Risk: evidence becomes too short for reliable validation in Pass 1.6a.                                           |

#### Quality optimizations

| Idea                                               | Impact                           | Complexity                                 |
| -------------------------------------------------- | -------------------------------- | ------------------------------------------ |
| **Expand synonym table**                           | Fewer false ICD drops            | Low — add groups to `SYNONYM_GROUPS`       |
| **Context-aware stem length**                      | Fewer false positive ICD matches | Medium — currently fixed at 6 chars        |
| **Two-pass ICD: Haiku proposes, Sonnet validates** | Better ICD accuracy              | High — adds another LLM call               |
| **Per-section quality scoring**                    | Catch low-quality sections       | Medium — Haiku review pass post-generation |

---

## 13. Data Model (Pipeline-Related)

### 13.1 Key `visits` columns

```
id                  uuid (PK)
user_id             uuid (FK auth.users)
title               text
language            text (sk | cs | en)
status              text (draft | to_review | finalized | archived)
encounter_note      text     -- HTML note
metadata            jsonb    -- see below
```

### 13.2 `metadata` JSONB shape (generation-related fields)

```jsonc
{
  "template_id": "soap_v1",
  "clinical_analysis": {
    "inferredSpecialty": "cardiology",
    "secondarySpecialty": null,
    "matchedConcepts": [...],
    "candidateIcdCodes": [...],       // post-Pass-1.7 filtered
    "suggestedIcdCodes": [...],       // ALL Pass 1 candidates (pre-filter)
    "problemClusters": [...],
    "mentionedMedications": [...]
  },
  "validated_facts": {                // persisted for structured rerender (§11.1)
    "demographics": [...],
    "chiefComplaint": [...],
    "diagnoses": [...],
    // ... all 15 categories
  },
  "generation_fingerprint": { "composite": "sha256:...", "components": {...} },
  "generation_history": [
    { "at": "2026-04-09T...", "operation": "generate", "fingerprint": {...} },
    { "at": "2026-04-10T...", "operation": "rerender_template", ... }
  ]
}
```

### 13.3 Persistence pattern

**Split save** to keep metadata writes atomic:

1. **Column update** via `.update()` for non-JSONB: `encounter_note`, `title`, `status`
2. **Atomic metadata merge** via `mergeVisitMetadata()` RPC for JSONB

The column update goes through `retrySupabaseCall` from [web/src/lib/supabase/retry.ts](web/src/lib/supabase/retry.ts) — long Opus runs keep a Supabase keepalive connection idle past the Cloudflare 100s edge timeout.

### 13.4 Determinism audit

`computeFingerprint(...)` in [fingerprint.ts](web/src/lib/clinical/fingerprint.ts) — SHA-256 over transcript + doctor notes + files + clinical analysis + validated facts + system prompt + user message. `diffFingerprints(a, b)` tells us which component changed.

---

## 14. Model Map

| Pass                       | Model ID                                        | Role                                | Why                                                   |
| -------------------------- | ----------------------------------------------- | ----------------------------------- | ----------------------------------------------------- |
| File OCR (image / PDF)     | `claude-sonnet-4-6` (t=0, 8192 tokens)          | Image + PDF -> text                 | Deterministic, same quality tier as clinical pass     |
| Pass 1 — Clinical analysis | `claude-sonnet-4-6` (t=0, 4096 tokens)          | Concepts, specialty, ICDs, clusters | Haiku couldn't distinguish anatomically-specific ICDs |
| Pass 1.5 — Fact extraction | `claude-haiku-4-5-20251001` (t=0, 16384 tokens) | Grounded facts with evidence        | Cheap + fast + good enough at strict-rules JSON       |
| Pass 2 — Generation        | `claude-opus-4-6` (t=0, 8192 tokens)            | Prose note (no title)               | Opus handles multi-section structured generation best |
| Title generation           | `claude-haiku-4-5-20251001` (t=0, 64 tokens)    | Short title from ICDs               | Cheap, deterministic, no room to hallucinate          |
| Structured rerender        | Same fallback chain as Pass 2                   | Template swap (with cached facts)   | Re-runs fact-to-section with new template             |
| Legacy reformat            | Same fallback chain as Pass 2                   | Template swap (no cached facts)     | Pure prose reformat, no clinical reasoning            |
| Transcription              | `scribe_v2` (ElevenLabs)                        | Audio -> text                       | Better SK/CS than Whisper                             |

All Anthropic calls use `temperature: 0`. The determinism guarantees come from the deterministic gates (Pass 1.6, 1.7, 2.5), not from temperature alone.

---

## 15. Non-Determinism Sources & Absorption

| Source                                          | Absorbed by                                   |
| ----------------------------------------------- | --------------------------------------------- |
| Pass 1 concept count drifting (9 vs 7)          | Concepts are hints, not ground truth          |
| Pass 1 ICD candidates including weak inferences | **Pass 1.7** drops ungrounded codes           |
| Pass 1.5 mislabeling `transcript` vs `file`     | **Pass 1.6a** cross-source fallback           |
| Pass 1.5 paraphrasing evidence                  | Fuzzy matcher in `evidenceAppearsInSource`    |
| Pass 1.5 emitting both sides of a correction    | **Pass 1.6b** correction-phrase detector      |
| Opus ignoring "only these ICDs" constraint      | **Pass 2.5** defensive strip                  |
| Opus placing facts in wrong sections            | **Fact-to-section pre-assignment**            |
| Opus injecting med lists into OA/SA             | **Pass C** `enforceContentRouting()` post-proc |
| Opus placing substance use in SA instead of Ab  | **Pass C** substance use stripping             |
| Opus placing allergies in EA/OA instead of AA   | **Pass C** allergy content stripping           |
| Opus rephrasing fact values                     | **FACT VALUE FIDELITY** rule in system prompt |
| Opus emitting bullet points despite instruction | **Pass A** `stripBulletMarkers()` post-proc   |
| Opus writing content in parent sections         | **Pass B** parent-section clearing            |
| Template change losing fact structure           | **Structured rerender** from cached facts     |

---

## 16. Tests

| File                                                                                | Coverage                                                                                          |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [fact-extraction.test.ts](web/src/lib/clinical/fact-extraction.test.ts)             | Prompt building, `coerceFact`, empty-input short-circuit                                          |
| [fact-validator.test.ts](web/src/lib/clinical/fact-validator.test.ts)               | `normalizeForMatch`, `evidenceAppearsInSource`, cross-source fallback, dedup, medication warnings |
| [fact-resolver.test.ts](web/src/lib/clinical/fact-resolver.test.ts)                 | Correction phrase detection (sk/cs/en), punctuation-bracketed negation, time-series preservation  |
| [icd-certainty.test.ts](web/src/lib/clinical/icd-certainty.test.ts)                 | 38+ tests: EMS regression, broad grounding, synonyms, R-chapter exclusion, determinism            |
| [pipeline.test.ts](web/src/lib/clinical/pipeline.test.ts)                           | `buildEnrichedSystemPrompt`, `buildPreRenderedIcdBlock`, `hasValidatedFacts` flag behavior        |
| [anthropic.test.ts](web/src/lib/anthropic.test.ts)                                  | `buildFactBasedSystemPrompt`, `buildTemplateSystemPrompt`                                         |
| [fact-section-assigner.test.ts](web/src/lib/clinical/fact-section-assigner.test.ts) | Category-to-section mapping, abbreviation matching, TO/HPI routing, unassigned fallback           |
| [fingerprint.test.ts](web/src/lib/clinical/fingerprint.test.ts)                     | SHA-256 stability, `diffFingerprints`                                                             |
| [phi-scrubber.test.ts](web/src/lib/clinical/phi-scrubber.test.ts)                   | Name, birth number, phone, email, address scrubbing; clinical value preservation (GCS, BP, pupils) |
| [section-routing-validator.test.ts](web/src/lib/clinical/section-routing-validator.test.ts) | All 6 routing rules, med block thresholds, narrative context preservation, immutability    |
| [assessment-classifier.test.ts](web/src/lib/clinical/assessment-classifier.test.ts) | Active/chronic/background tiering, cap enforcement, overflow handling                             |
| [medication-normalizer.test.ts](web/src/lib/clinical/medication-normalizer.test.ts) | `parseMedicationFact`/`reconstructMedicationValue`, dose/frequency preservation                   |

---

## 17. Where to Make Changes

| Want to...                     | Touch this                                                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change what Pass 1 extracts    | [prompts.ts](web/src/lib/clinical/prompts.ts) and [pipeline.ts](web/src/lib/clinical/pipeline.ts)                                                                                                       |
| Change what counts as a fact   | [fact-extraction.ts](web/src/lib/clinical/fact-extraction.ts)                                                                                                                                           |
| Change how facts are validated | [fact-validator.ts](web/src/lib/clinical/fact-validator.ts)                                                                                                                                             |
| Change correction detection    | [fact-resolver.ts](web/src/lib/clinical/fact-resolver.ts)                                                                                                                                               |
| Change ICD certainty           | [icd-certainty.ts](web/src/lib/clinical/icd-certainty.ts)                                                                                                                                               |
| Change the Opus system prompt  | [anthropic.ts](web/src/lib/anthropic.ts) `buildFactBasedSystemPrompt` (facts path) / `buildTemplateSystemPrompt` (legacy) + [pipeline.ts](web/src/lib/clinical/pipeline.ts) `buildEnrichedSystemPrompt` |
| Change the Opus user message   | [anthropic.ts](web/src/lib/anthropic.ts) `buildTemplateUserMessage`                                                                                                                                     |
| Wire in a new pipeline stage   | Both [generate/route.ts](web/src/app/api/generate/route.ts) and [regenerate/route.ts](web/src/app/api/regenerate/route.ts)                                                                              |
| Add a specialty prompt pack    | [specialty-prompts.ts](web/src/lib/clinical/specialty-prompts.ts)                                                                                                                                       |
| Add ICD synonym group          | [icd-certainty.ts](web/src/lib/clinical/icd-certainty.ts) `SYNONYM_GROUPS`                                                                                                                              |
| Change section routing rules   | [section-routing-validator.ts](web/src/lib/clinical/section-routing-validator.ts) — Pass C rules, keyword lists, section role classification                                                            |
| Change PHI scrubbing rules     | [phi-scrubber.ts](web/src/lib/clinical/phi-scrubber.ts) — regex patterns, clinical value protections                                                                                                    |
| Bump a model ID                | [pipeline.ts](web/src/lib/clinical/pipeline.ts), [fact-extraction.ts](web/src/lib/clinical/fact-extraction.ts), [anthropic.ts](web/src/lib/anthropic.ts), and [usage.ts](web/src/lib/usage.ts)          |

---

_This document is checked into the repo at [kb/prompt-pipeline.md](kb/prompt-pipeline.md). For data intake, see [data-extraction.md](data-extraction.md). If something here disagrees with the code, the code wins — and then update the doc._
