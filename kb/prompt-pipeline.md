# MediTalk Prompt Pipeline — Deep Dive

_Last updated: 2026-04-15_

How raw clinical data becomes a structured medical note. This document covers every LLM call, the exact prompt texts, the deterministic filters between them, and cost/speed characteristics. For data intake (recording, transcription, file upload, doctor notes), see [data-extraction.md](data-extraction.md).

Read this before touching anything in [web/src/app/api/generate/route.ts](web/src/app/api/generate/route.ts), [web/src/app/api/regenerate/route.ts](web/src/app/api/regenerate/route.ts), [web/src/lib/clinical/](web/src/lib/clinical/), or [web/src/lib/anthropic.ts](web/src/lib/anthropic.ts).

---

## 0. Pipeline Overview

```
              INPUTS
               |
  transcript + files + doctor notes
               |
       ========|========  LLM CALLS  ========|========
               |                              |
  Pass 1       |   Sonnet 4.6  (t=0)          |  Embedding search
  Clinical     |   max_tokens: 4096           |  (legacy only)
  Analysis     |                              |
               |                              |
               v                              v
  Pass 1.5     Haiku 4.5  (t=0)
  Fact         max_tokens: 16384
  Extraction   -> 15-category ExtractedFacts
               |
       ========|========  DETERMINISTIC GATES  ========
               |
  Pass 1.6a    validateFacts          pure TS
               -> drop ungrounded evidence, dedup, cross-source fallback
               |
  Pass 1.6b    resolveFacts           pure TS
               -> drop self-corrected facts ("vlastne", ", nie,")
               |
  Pass 1.7     filterCertainIcdCandidates   pure TS
               -> drop ICD codes not lexically grounded in facts
               -> two-tier: broad (non-R) vs strict (R-chapter)
               -> synonym table bridges layperson<->medical terms
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
               -> JSON: one key per section + letter + title
               |
       ========|========  POST-PROCESSING  ========
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
2. **Every ICD code is grounded.** Pass 1.7 drops candidates that aren't lexically rooted in validated facts. Pass 2.5 defensively strips any Opus snuck past the prompt.
3. **Same inputs -> same outputs** for the entire post-Pass-1 pipeline. Pass 1 LLM noise is absorbed by deterministic downstream gates. ICD codes are pre-rendered in sorted order (VERBATIM copy), facts are pre-assigned to template sections, and transcript is omitted when facts are present — Opus acts as a formatter, not a reasoner.

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

In parallel with the (legacy) embedding-based chunk retrieval:

```ts
const [embeddingResult, rawClinicalAnalysis] = await Promise.all([
  embeddingPromise,
  clinicalPromise,
]);
```

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
10. Write fact `value` fields in {language}. Keep them short (<=120 chars).
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

**Medication auto-correction:** Validates against the approved list via `isValidMedication`. On miss, `correctMedicationName` attempts fuzzy matching (Levenshtein distance >= 0.7). Auto-corrects on confident match (e.g. `"Koprenesa"` -> `"Co-Prenessa"`).

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
chiefComplaint -> dovod, reason, chief complaint
symptoms      -> symptom, priznak, complaints
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

### 8.1 Base system prompt

Source: [web/src/lib/anthropic.ts:56](web/src/lib/anthropic.ts#L56) — `buildTemplateSystemPrompt()`

The base prompt is either the template's custom `systemPrompt` (with variable interpolation) or the default:

```
You are a medical documentation assistant. You MUST follow these rules strictly:

CRITICAL — SECTION-SPECIFIC GUIDANCE OVERRIDES ALL:
If a section below has "SECTION-SPECIFIC GUIDANCE", that guidance ALWAYS takes
absolute precedence over any general rule.

1. INSUFFICIENT CONTEXT CHECK: Before generating, assess whether the input
   contains enough meaningful clinical information. If too vague/short, return
   ONLY: {"insufficient_context": true}

2. STRICT GROUNDING — NO ASSUMPTION MODE: Only use information explicitly present
   in the provided transcript chunks, uploaded file contents, and doctor's notes.
   Do NOT infer, assume, estimate, or hallucinate any medical facts.

2a. NEVER FABRICATE MISSING CLINICAL DIMENSIONS: If a numeric value appears
    WITHOUT a unit or dimension, you MUST NOT invent the missing dimension.
    Write e.g. "fajci 15 (blizsie nespecifikovane)".

2b. FACT VALUE FIDELITY (when VALIDATED CLINICAL FACTS are provided): The
    pre-assigned facts are the sole source of clinical truth. Your job is to
    FORMAT them into the note, not to REWRITE them.
    - Reproduce each fact's wording as closely as possible.
    - Do NOT rephrase, paraphrase, elaborate, summarize, or add context.
    - Do NOT merge multiple facts into compound sentences.
    - Present facts in the EXACT order they appear in the input.
    - If a section has pre-assigned facts, derive content exclusively from them.
    - The same facts must produce the same output text every time.

3. SOURCE PRIORITY (highest to lowest):
   1. Actual spoken transcript
   2. Doctor's additional notes
   3. Uploaded documents

3a. DOCTOR NOTES AS DIRECTIVES: When doctor notes contain filtering/processing
    instructions, treat them as authoritative and follow exactly.

3b. PER-FILE DIRECTIVES: Individual files may have a "DOCTOR'S DIRECTIVE FOR
    THIS FILE:" line. Only use the permitted information from that file.

4. OUTPUT LANGUAGE: Write ALL content in {language}. Only exceptions: Latin
   medical terminology and proper nouns.

5. MISSING SECTIONS: Use empty string "" — no "Not stated" placeholders.

6. FORMATTING: Use bullet points for diagnoses, ICD codes, medications, action
   items. Code first, then name ("- I10 Esencialna hypertenzia"). Narrative for
   history/examination.

7. FORMAT: Return valid JSON with keys per section + "letter" + "title".
   TITLE RULES:
   - Consistent with primary diagnosis in assessment
   - No severity qualifiers unless in source AND in the ICD description
   - No anatomical localisation unless in the ICD description
   - Max 6 words

8. SECTION CONTENT ROUTING — MANDATORY placement rules:
   HARD ROUTING RULES:
   a) Medications -> ONLY in LA/Meds sections. NEVER in TO/HPI.
   b) Substance use -> ONLY in Ab sections. NEVER in PA or SA.
   c) Work/occupation -> ONLY in PA sections. NEVER in SA.
   d) Social circumstances -> ONLY in SA sections. NEVER in PA.
   e) Chief complaint/symptoms -> ONLY in TO/HPI sections.
   f) Family history -> ONLY in RA sections.
   g) Past medical history -> ONLY in OA sections.
   h) Allergies -> ONLY in AA sections.

TEMPLATE SECTIONS:
{sections}
{styleGuide}
```

### 8.2 Enriched system prompt

Source: [web/src/lib/clinical/pipeline.ts:137](web/src/lib/clinical/pipeline.ts#L137) — `buildEnrichedSystemPrompt()`

The base gets augmented with four blocks:

**1. Specialty prompt pack** (from [specialty-prompts.ts](web/src/lib/clinical/specialty-prompts.ts)):

```
{pack.systemPromptAddendum}
TERMINOLOGY: {pack.terminologyNotes}
EMPHASIZED SECTIONS: {pack.emphasizedSections}
```

When the template declares a `specialties` field, the template specialty overrides Pass 1's `inferredSpecialty`.

**2. Medication verification block:**

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

**4. Clinical concepts and problem clusters:**

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
5. Each fact = one distinct statement or bullet point. Do NOT merge facts.

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
JSON with keys: "s_to", "s_oa", "s_ra", ..., "letter", and "title".
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

1. **ICD description validation** — `validateIcdDescriptions()` replaces any hallucinated/paraphrased ICD descriptions with exact canonical CSV text.
2. **ICD code extraction** — `extractIcdCodesFromSections()` scans generated text for `- CODE Description` lines.
3. **Pass 2.5 defensive filter** — intersects extracted codes with the pre-filtered candidate set. Strips unauthorized codes from both the sidebar list AND the section text.
4. **HTML rendering** — `buildTemplateHtml()` wraps section contents into the template HTML structure.

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

## 11. Regenerate — Two Paths

File: [web/src/app/api/regenerate/route.ts](web/src/app/api/regenerate/route.ts)

### 11.1 Fast reformat path

Triggered when the only change is a new template selection. Uses the **same model fallback chain** (Opus -> Sonnet) to reformat the existing note into the new template layout. Doesn't re-run Pass 1 / Pass 1.5. Reuses existing patient letter and title.

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

### 11.2 Full path

Identical pipeline to `/api/generate`. Optionally reuses cached `clinical_analysis` from metadata to skip Pass 1. Always runs Pass 1.5 through Pass 2.5.

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

### 12.3 Pipeline timing (serial execution)

```
                   0s        5s        10s       15s       20s       25s
                   |---------|---------|---------|---------|---------|
Transcription      |=========|                                        ~3-8s
File OCR                     |===|                                    ~2-4s
                             \--- runs in parallel where possible ---/
Pass 1 (Sonnet)    |=========|                                        ~3-6s
Pass 1.5 (Haiku)             |=====|                                  ~4-8s
Pass 1.6a/b, 1.7                   |=|                               <100ms
Fact assignment                      |                                <10ms
Pass 2 (Opus)                        |================|              ~10-25s
Pass 2.5 + title                                      |=|            ~1-2s
                   |---------|---------|---------|---------|---------|
                   0s        5s        10s       15s       20s       25s
```

**Key parallelism in the current pipeline:**

- Pass 1 (Sonnet) runs in parallel with legacy embedding search
- File extractions run in parallel with each other
- Transcription happens client-side before the generate call

**Total wall time:** ~15-35s depending on transcript length and model load

### 12.4 Optimization opportunities

#### Speed optimizations

| Idea                                  | Savings                  | Complexity | Trade-off                                                                                                                                                                                                          |
| ------------------------------------- | ------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Run Pass 1 + Pass 1.5 in parallel** | ~4-8s                    | Medium     | Pass 1.5 doesn't depend on Pass 1 output — it reads raw sources. Pass 1 output is only used for ICD candidates and specialty. Could run both, then apply Pass 1.7 filter after both complete.                      |
| **Cache Pass 1 by input hash**        | Skip ~3-6s on regenerate | Low        | Already partially done (cached `clinical_analysis` in metadata). Could content-address by transcript+files hash to skip the Sonnet call entirely on regenerate.                                                    |
| **Stream Pass 2 start earlier**       | Perceived ~5s faster     | Low        | Start streaming Opus while Pass 1.7 is still running. The system prompt can be built incrementally — specialty and concepts are available from Pass 1, ICD block can be injected as a late user-message amendment. |
| **Replace Opus with Sonnet 4.6**      | ~5-10s faster generation | Low        | Sonnet is 3-5x faster than Opus. Quality trade-off needs testing — Opus handles multi-section structured generation more reliably.                                                                                 |

#### Cost optimizations

| Idea                                            | Savings                                | Complexity | Trade-off                                                                                                                                                                         |
| ----------------------------------------------- | -------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Replace Opus with Sonnet 4.6 for generation** | ~75% of Pass 2 cost (~$0.24/encounter) | Low        | Sonnet 4.6 is 5x cheaper on input, 5x cheaper on output. Quality trade-off: Opus produces better-structured, more natural Slovak medical prose. Could A/B test.                   |
| **Prompt compression**                          | ~10-20% of Pass 2 cost                 | Medium     | The system prompt is ~2000 tokens. Could compress by removing redundant rules, using shorter phrasing. Diminishing returns — most tokens are in the user message (facts + files). |
| **Skip Pass 1 when facts are sufficient**       | ~$0.04/encounter                       | Medium     | If Pass 1.5 extracts enough facts for the note, Pass 1's concepts/specialty/ICD hints become less critical. Could make Pass 1 conditional on encounter complexity.                |
| **Shorter fact evidence quotes**                | ~15% of Pass 1.5 input tokens          | Low        | Currently 120-char max. Could reduce to 80 chars. Risk: evidence becomes too short for reliable validation in Pass 1.6a.                                                          |

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
patient_letter      text     -- HTML letter
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
  "generation_fingerprint": { "composite": "sha256:...", "components": {...} },
  "generation_history": [
    { "at": "2026-04-09T...", "operation": "generate", "fingerprint": {...} }
  ]
}
```

### 13.3 Persistence pattern

**Split save** to keep metadata writes atomic:

1. **Column update** via `.update()` for non-JSONB: `encounter_note`, `patient_letter`, `title`, `status`
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
| Pass 2 — Generation        | `claude-opus-4-6` (t=0, 8192 tokens)            | Prose note + letter + title         | Opus handles multi-section structured generation best |
| Title generation           | `claude-haiku-4-5-20251001` (t=0, 64 tokens)    | Short title from ICDs               | Cheap, deterministic, no room to hallucinate          |
| Reformat (regen fast path) | Same fallback chain as Pass 2                   | Template swap                       | Pure reformat, no clinical reasoning                  |
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
| Opus rephrasing fact values                     | **FACT VALUE FIDELITY** rule in system prompt |

---

## 16. Tests

| File                                                                                | Coverage                                                                                          |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [fact-extraction.test.ts](web/src/lib/clinical/fact-extraction.test.ts)             | Prompt building, `coerceFact`, empty-input short-circuit                                          |
| [fact-validator.test.ts](web/src/lib/clinical/fact-validator.test.ts)               | `normalizeForMatch`, `evidenceAppearsInSource`, cross-source fallback, dedup, medication warnings |
| [fact-resolver.test.ts](web/src/lib/clinical/fact-resolver.test.ts)                 | Correction phrase detection (sk/cs/en), punctuation-bracketed negation, time-series preservation  |
| [icd-certainty.test.ts](web/src/lib/clinical/icd-certainty.test.ts)                 | 38+ tests: EMS regression, broad grounding, synonyms, R-chapter exclusion, determinism            |
| [pipeline.test.ts](web/src/lib/clinical/pipeline.test.ts)                           | `buildEnrichedSystemPrompt`, `buildPreRenderedIcdBlock`                                           |
| [fact-section-assigner.test.ts](web/src/lib/clinical/fact-section-assigner.test.ts) | Category-to-section mapping, abbreviation matching, unassigned fallback                           |
| [fingerprint.test.ts](web/src/lib/clinical/fingerprint.test.ts)                     | SHA-256 stability, `diffFingerprints`                                                             |

---

## 17. Where to Make Changes

| Want to...                     | Touch this                                                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change what Pass 1 extracts    | [prompts.ts](web/src/lib/clinical/prompts.ts) and [pipeline.ts](web/src/lib/clinical/pipeline.ts)                                                                                              |
| Change what counts as a fact   | [fact-extraction.ts](web/src/lib/clinical/fact-extraction.ts)                                                                                                                                  |
| Change how facts are validated | [fact-validator.ts](web/src/lib/clinical/fact-validator.ts)                                                                                                                                    |
| Change correction detection    | [fact-resolver.ts](web/src/lib/clinical/fact-resolver.ts)                                                                                                                                      |
| Change ICD certainty           | [icd-certainty.ts](web/src/lib/clinical/icd-certainty.ts)                                                                                                                                      |
| Change the Opus system prompt  | [anthropic.ts](web/src/lib/anthropic.ts) `buildTemplateSystemPrompt` + [pipeline.ts](web/src/lib/clinical/pipeline.ts) `buildEnrichedSystemPrompt`                                             |
| Change the Opus user message   | [anthropic.ts](web/src/lib/anthropic.ts) `buildTemplateUserMessage`                                                                                                                            |
| Wire in a new pipeline stage   | Both [generate/route.ts](web/src/app/api/generate/route.ts) and [regenerate/route.ts](web/src/app/api/regenerate/route.ts)                                                                     |
| Add a specialty prompt pack    | [specialty-prompts.ts](web/src/lib/clinical/specialty-prompts.ts)                                                                                                                              |
| Add ICD synonym group          | [icd-certainty.ts](web/src/lib/clinical/icd-certainty.ts) `SYNONYM_GROUPS`                                                                                                                     |
| Bump a model ID                | [pipeline.ts](web/src/lib/clinical/pipeline.ts), [fact-extraction.ts](web/src/lib/clinical/fact-extraction.ts), [anthropic.ts](web/src/lib/anthropic.ts), and [usage.ts](web/src/lib/usage.ts) |

---

_This document is checked into the repo at [kb/prompt-pipeline.md](kb/prompt-pipeline.md). For data intake, see [data-extraction.md](data-extraction.md). If something here disagrees with the code, the code wins — and then update the doc._
