# MediTalk — Prompt Pipeline Improvements Plan (v3)
_Last updated: 2026-04-17_

---

## IMPORTANT NAMING CHANGE

Rename all pipeline stages to **strict sequential numbering**:

- Remove: Pass 0.5, Pass 1.5, Pass 1.6a, Pass 1.7, etc.
- Use:

Pass 1.1
Pass 1.2
Pass 1.3
Pass 1.4
Pass 1.5
Pass 1.6
Pass 1.7
Pass 1.8
Pass 2
Pass 2.1
Pass 2.2

### Why

- Makes pipeline easier to reason about
- Makes logs + debugging readable
- Makes execution order obvious
- Eliminates side-pass confusion

---

# NORTH STAR

The system MUST behave as:

> Deterministic clinical state builder -> deterministic renderer

NOT:

> Transcript summarizer

The final system MUST:

1. Ingest raw sources
2. Remove PHI before any LLM reasoning
3. Distinguish current encounter truth from prior-report context
4. Extract only grounded facts
5. Normalize time and medication state
6. Build a structured encounter-state object
7. Render the note only from that state
8. Defensively filter output before persistence

---

# FAILURE MODES TO ELIMINATE

## 1. Medication hallucination
- wrong medication name
- invented dosage
- invented frequency
- hybrid line stitched from conflicting transcript + OCR facts
- stale OCR med list overriding current doctor/patient discussion

## 2. Timeline inconsistency
- "today" mapped to wrong date
- "yesterday" attached to wrong event
- symptom onset sequence flattened incorrectly
- prior CPO/ER visit blended into current admission
- last medication dose timing lost or attached to wrong day

## 3. OCR dominating transcript incorrectly
- prior report treated as current admission truth
- current note over-copies previous report language
- prior physical exam or prior assessment leaks into today's note

## 4. ICD / assessment over-generation
- giant diagnostic dump in conclusion
- historical diagnoses promoted into active current assessment
- model turns any relevant symptom/history into current disease coding
- background-only conditions clutter the active Zaver

## 5. PHI leakage
- patient name in note
- address in note
- exact DOB in note
- IDs / insurance numbers in note
- PHI preserved in facts / metadata unnecessarily

## 6. Wrong note mode
- output acts like a full chart summary
- too verbose for admission workflow
- history not compressed enough
- note not selective enough for hospital logic

## 7. Source conflict instability
- different runs choose different truth sources
- same inputs lead to different medication/history/assessment emphasis
- no deterministic tie-breaker for source conflicts

## 8. Unsafe uncertainty handling
- uncertain fact rendered as confirmed truth
- suspected diagnosis rendered as established diagnosis
- old report recommendations rendered as current plan
- unclear medication details upgraded into exact instructions

## 9. Formatting / style mismatch
- bullet points used where comma-separated or inline list expected (AA, LA)
- ICD validation overwrites original diagnosis wording with CSV canonical text — doctor wants original dg. text preserved alongside ICD code
- section ordering doesn't match hospital convention (e.g. TO should come first under Anamnézy, parent "Anamnézy" heading should be empty)
- parent section headings rendered with content when they should be structural-only

---

# PIPELINE — FINAL TARGET STRUCTURE

INPUTS
|
Pass 1.1 — PHI SCRUB
|
Pass 1.2 — SOURCE TAGGING & PRIORITY
|
Pass 1.3 — FACT EXTRACTION (STRICT)
|
Pass 1.4 — FACT VALIDATION
|
Pass 1.5 — FACT RESOLUTION (CORRECTIONS + DEDUP)
|
Pass 1.6 — MEDICATION NORMALIZATION
|
Pass 1.7 — TIMELINE STRUCTURING
|
Pass 1.8 — ENCOUNTER STATE BUILDER
|
Pass 2 — NOTE GENERATION (FORMATTER ONLY)
|
Pass 2.1 — DEFENSIVE FILTERS
|
Pass 2.2 — TITLE GENERATION

---

# IMPLEMENTATION PHASES

This improvement plan MUST be executed in phases.

Do NOT treat this as one giant rewrite.

Each phase should:
- preserve the working pipeline
- add one coherent capability
- be testable independently
- reduce one major class of physician-visible failures

The recommended execution order is:

## Phase 1 — Safety & Scope Control
Focus:
- PHI leakage
- medication hallucination
- assessment overload
- OCR overuse

## Phase 2 — Temporal + Source-Aware Clinical State
Focus:
- timeline correctness
- prior vs current source separation
- current encounter truth assembly

## Phase 3 — Note-Mode-Specific Rendering
Focus:
- focused admission-note logic
- compact hospital style
- selective section rendering
- tighter deterministic formatting

## Phase 4 — Review Layer + Doctor Calibration
Focus:
- structured quality review
- gold-note comparison
- doctor-specific compression/stylistic calibration
- controlled feedback loop

---

# PHASE 1 — SAFETY & SCOPE CONTROL

## Objective

Fix the most dangerous and most visible failures first:

- PHI leakage
- medication hallucination
- historical overload in assessment
- prior OCR report dominating current note
- unsafe certainty upgrades

## Deliverables

Phase 1 MUST implement:

1. deterministic PHI scrub before any LLM call
2. medication normalization / conflict handling
3. explicit diagnosis/problem relevance classification
4. focused admission-note prompting constraints
5. defensive assessment caps / ranking rules
6. final PHI scrub before persistence

## Success criteria

Phase 1 is successful if:

- no note contains name / address / DOB / patient ID
- medication doses are never invented
- assessment is visibly shorter and more clinically current
- prior OCR/CPO report no longer dominates the note body
- repeated reruns are more stable

---

# PASS 1.1 — PHI SCRUB

## Role

Deterministically remove patient-identifying information before any LLM call.

## Type

Pure TypeScript / deterministic logic only
No model call

## Inputs

- transcript
- OCR text / uploaded file text
- doctor notes
- optional structured patient metadata if available

## Output

Sanitized source payload:

- sanitized transcript
- sanitized OCR text
- sanitized doctor notes
- safe scrub audit metadata

## PHI classes to remove or replace

### Remove / replace with placeholders

- patient full name -> `[PATIENT_NAME]`
- exact DOB -> `[DOB]`
- address -> `[ADDRESS]`
- phone -> `[PHONE]`
- email -> `[EMAIL]`
- patient number / insurance number / birth number / member ID -> `[PATIENT_ID]`

## Keep when clinically relevant

- age (derived or preserved if not directly identifying by product policy)
- sex
- symptom dates
- admission dates
- procedure dates
- medication dates
- clinically relevant timing language

## Rules

1. Prefer stable placeholders over deletion.
2. Do not rely on prompt instructions for PHI omission.
3. Do not store raw PHI in scrub audit metadata.
4. Apply same scrub logic to transcript, OCR text, and doctor notes.
5. Apply a final defensive PHI scrub again in Pass 2.1 before persistence.

## Safe audit metadata example

- scrubber version
- redaction counts by type
- source block counts

Never store:
- original removed name
- original removed DOB
- original removed address
- original removed IDs

## Testing requirements

Must test:

- full patient name replacement
- exact DOB replacement
- address replacement
- phone replacement
- email replacement
- patient ID replacement
- repeated occurrences
- OCR-like noisy versions of identifiers
- age preserved where intended
- clinical dates NOT scrubbed accidentally

---

# PASS 1.2 — SOURCE TAGGING & PRIORITY

## Role

Explicitly classify each source and assign deterministic source priority.

## Objective

Prevent prior OCR reports from overriding current encounter truth.

## Type

Can be:
- deterministic + heuristics
- or small structured LLM classifier
- but final priority application MUST be deterministic

## Source classes

Each source block MUST be tagged as one of:

- `current_transcript`
- `doctor_instruction`
- `prior_external_report`
- `current_exam_data`
- `current_lab_data`
- `current_ecg_data`
- `current_echo_data`
- `background_history`
- `unknown_supporting_source`

## Minimum current source types in present system

- transcript
- doctor_notes
- file (OCR)

## Base priority

1. doctor_notes
2. transcript
3. file (OCR)

## Extended priority rules

### For current complaint / TO
1. doctor instructions
2. current transcript
3. current same-encounter structured report
4. prior report

### For objective findings
1. current measured data
2. current encounter transcript statements by clinician
3. prior report only if explicitly used as comparison / background

### For OA / chronic history
1. doctor instructions
2. transcript
3. prior report

### For medications
1. doctor instructions
2. explicit current transcript confirmation
3. structured medication list from report
4. stale unstructured mentions

### For plan
1. current transcript doctor statements
2. current encounter written plan
3. prior report recommendations only as background

## Output per source block

Each source block should produce:

- source type
- priority weight
- shouldBeUsedAsPrimaryNarrativeSource: boolean
- shouldBeUsedAsBackgroundOnly: boolean
- rationale

## Rules

1. Prior OCR report MUST NOT be treated as default current truth.
2. Doctor notes can override file usage.
3. Source priority application must be deterministic.
4. If conflict exists, higher-priority source wins unless specifically marked uncertain.

## Testing requirements

Must test:

- prior CPO/ER report tagged as prior_external_report
- current transcript tagged as current_transcript
- doctor instructions override file
- file does not dominate TO when transcript exists
- file may contribute more strongly to OA / historical context

---

# PASS 1.3 — FACT EXTRACTION (STRICT)

## Role

Extract only explicitly stated facts from sanitized inputs.

## Objective

Create a grounded fact set without inference.

## Type

LLM extraction pass

## Rules

1. Extract ONLY facts explicitly stated in the sources.
2. No inference.
3. No diagnosis upgrades.
4. No severity upgrades.
5. No medication dose invention.
6. Every fact MUST include verbatim evidence.
7. Multiple mentions may coexist temporarily.
8. Do not merge facts at this stage.
9. Preserve uncertainty markers.
10. Preserve source identity.

## Mandatory categories

- demographics
- chiefComplaint
- symptoms
- findings
- measurements
- diagnoses
- medications
- procedures
- familyHistory
- personalHistory
- socialHistory
- workHistory
- substanceUse
- epidemiologicalHistory
- plan

## Additional required attributes

Each fact should include at minimum:

- category
- value
- source type
- source index
- verbatim evidence
- extraction confidence if available

## Important extraction bias

This pass must prefer under-extraction to hallucinated extraction.

## Testing requirements

Must test:

- no inference from vague symptoms
- no diagnosis upgrade from "ACS" to "NSTEMI" unless explicit
- dosage only included when explicit
- evidence always present
- uncertainty wording preserved

---

# PASS 1.4 — FACT VALIDATION

## Role

Verify that each extracted fact is truly grounded.

## Objective

Ensure no ungrounded extracted fact survives.

## Type

Pure deterministic validation

## Steps

1. Normalize source text and evidence
2. Verify evidence string exists in claimed source
3. Attempt token-order fallback
4. Attempt cross-source fallback when source mislabeled
5. remove invalid facts
6. deduplicate facts
7. remove empty facts

## Validation outcomes

Each fact becomes one of:

- valid
- valid_with_source_corrected
- removed_evidence_missing
- removed_duplicate
- removed_empty
- removed_invalid_source

## Important rules

1. Validation may change source attribution only when evidence truly matches another source.
2. Validation must not rewrite clinical fact meaning.
3. Deduplication must not collapse legitimate repeated time-series measurements.
4. Medication name normalization may happen later; validation only checks grounding.

## Testing requirements

Must test:

- exact evidence match
- fuzzy normalized match
- transcript/file mislabel rescue
- duplicates removed
- empty values removed
- time-series readings preserved

---

# PASS 1.5 — FACT RESOLUTION (CORRECTIONS + DEDUP)

## Role

Resolve self-corrections and remove outdated conflicting mentions.

## Objective

Prevent speaker corrections from becoming parallel truths.

## Type

Pure deterministic resolution

## Rules

1. Detect correction phrases:
   - "actually"
   - "sorry"
   - "I mean"
   - "vlastne"
   - "nie"
   - similar locale-specific correction markers
2. When a correction is detected, older corrected fact is removed.
3. Preserve the corrected/latest valid fact.
4. Do not collapse legitimate repeated events that are not corrections.
5. Do not use simplistic last-number-wins logic.

## Example problems to solve

- speaker says wrong date, then corrects it
- speaker says wrong medication timing, then corrects it
- speaker says "no wait" or "nie, vlastne..."

## Testing requirements

Must test:

- Slovak correction detection
- English correction detection
- Czech correction detection
- no collapse of legitimate repeated blood pressure / symptom events
- corrected fact retained, outdated fact removed

---

# PASS 1.6 — MEDICATION NORMALIZATION

## CRITICAL PASS

## Role

Normalize and reconcile medication information safely.

## Objective

Eliminate medication hallucination completely.

## Type

Hybrid deterministic reconciliation layer
May use normalized medication index, but output rules MUST be deterministic

## Input sources

- validated medication facts from transcript
- structured medication facts from OCR/file
- doctor instructions / corrections
- optional medication index

## Output

A strict verified medication state:

- confirmed medications
- uncertain medications
- rejected/conflicting medications
- optional last-dose timing events

## Required fields per medication

- normalizedName
- rawMention
- dose
- frequency
- route if explicit
- sourceType
- sourcePriority
- sourceRecency
- confidence
- conflictFlags

## Rules

1. ONLY include medications explicitly stated.
2. NEVER invent dosage.
3. NEVER infer frequency.
4. NEVER modify dosage based on outside knowledge.
5. If OCR contains a structured medication list, use it as a strong source for medication names.
6. If transcript explicitly confirms dose/frequency, allow it only when truly explicit.
7. If transcript and OCR conflict, do not merge into a higher-specificity line.
8. If only medication name is certain, output name only.
9. If medication is uncertain, keep it in uncertain list or omit from final verified output.
10. Do not auto-upgrade "Eliquis" to a precise strength unless explicit.
11. Do not assume common dose for a known drug.
12. If doctor instructions explicitly limit medication usage from file, obey them.

## Priority logic

### Suggested deterministic logic

- doctor instructions override all
- explicit current transcript confirmation outranks stale report mention
- structured OCR list outranks fuzzy transcript recall for medication name spelling
- dosage/frequency only accepted from explicit mention
- conflict reduces specificity, not increases it

## Final medication output rules for renderer

The final renderer may use ONLY:

- confirmed medications with reliable fields
- or uncertain medication names without invented details if policy allows

The renderer may NEVER:
- add missing dose
- add missing frequency
- combine two partial sources unless reconciliation explicitly approved it

## Testing requirements

Must test:

- transcript-only medication without dose stays dose-less
- OCR structured med list used correctly
- conflicting dose does not get invented
- explicit current Eliquis timing preserved if grounded
- uncertain meds separated from confirmed meds
- no hallucinated strength for well-known drugs

---

# PASS 1.7 — TIMELINE STRUCTURING

## CRITICAL PASS

## Role

Normalize relative and ambiguous time expressions into a structured encounter timeline.

## Objective

Fix temporal reasoning errors before rendering.

## Type

Structured normalization pass
LLM or deterministic hybrid allowed
Final timeline object must be structured and explicit

## Must capture

- symptom onset
- symptom recurrence
- prior outpatient/internist/CPO/ER visit
- current admission date
- lab timing
- imaging timing
- medication last-dose timing
- previous historical events only when relevant

## Examples to normalize

- today
- yesterday
- last night
- from Sunday to Monday
- now it is Friday
- yesterday evening
- this Tuesday
- last June
- before admission
- after internist sent her in

## Output structure

Each event should include:

- event type
- event description
- normalized date or structured approximation
- source
- confidence
- whether current encounter or prior background

## Rules

1. Do not invent exact dates when only approximate relative time is available.
2. Preserve uncertainty when exact mapping is impossible.
3. Distinguish prior CPO/ER visit from current admission.
4. Distinguish current symptom status now vs earlier symptom timeline.
5. Capture medication last-dose timing separately from general event timeline.
6. Historical surgery dates do not belong in current symptom timeline.

## Testing requirements

Must test:

- "z nedele na pondelok"
- "vcera"
- "dnes 14.4."
- "teraz je piatok"
- "vcera vecer uz nie"
- prior CPO visit vs current admission separation
- timeline order stability

---

# PASS 1.8 — ENCOUNTER STATE BUILDER

## CORE ARCHITECTURE CHANGE

## Role

Build the structured clinical encounter state BEFORE generation.

## Objective

Turn raw grounded facts + normalized timeline + source priority + medication state into one deterministic truth object for rendering.

## Type

Deterministic / mostly deterministic assembly layer

## Output

A single encounterState object.

## Required top-level fields

- encounterType
- encounterDate
- sourceSummary
- currentPresentation
- history
- medications
- objective
- assessment
- plan

## Suggested structure

encounterState:

- encounterType
- encounterDate
- sourceSummary

currentPresentation:
- chiefComplaint
- timelineEvents
- symptomsActive
- symptomsResolved
- absentSymptoms

history:
- family
- personalRelevant
- socialRelevant
- workRelevant
- allergies
- substanceUse

medications:
- confirmed
- uncertain
- lastDoseEvents

objective:
- vitals
- physicalExam
- ecg
- echo
- labs
- imaging

assessment:
- activeCurrent
- chronicRelevant
- backgroundOnly
- uncertain

plan:
- immediate
- procedures
- followUp

## Deterministic classification rules inside encounter state

### activeCurrent
Use for:
- current admission reason
- active ongoing suspected/confirmed problem
- current cardiac workup target
- current clinically active symptom/problem

### chronicRelevant
Use for:
- chronic diseases important to current management
- major relevant cardiac/internal comorbidities

### backgroundOnly
Use for:
- true historical conditions not important enough to foreground in this note

### uncertain
Use for:
- unresolved conflicting facts
- suspected but unconfirmed items
- prior report conclusions not yet adopted as current truth

## Assessment cap rules

Suggested hard caps for focused admission note:

- activeCurrent: 2-4 items
- chronicRelevant: 3-5 items
- backgroundOnly: not rendered in main assessment
- uncertain: only rendered when clinically useful

## Rule

Renderer MUST use ONLY this state.

The renderer MUST NOT go back to raw source chaos when encounterState exists.

## Testing requirements

Must test:

- chest-pain current admission produces compact activeCurrent list
- chronicRelevant stays selective
- background historical surgeries do not flood assessment
- prior report suspected NSTEMI remains uncertain unless current evidence supports it
- current symptoms separated from historical background

---

# PHASE 2 — TEMPORAL + SOURCE-AWARE CLINICAL STATE

## Objective

Make the system understand:

- what happened when
- which source is current vs prior
- which facts belong in the current encounter note
- which items are background only

## Deliverables

Phase 2 MUST fully stabilize:

1. source-role tagging
2. section-specific source weighting
3. temporal normalization
4. encounter-state assembly
5. current vs prior clinical separation

## Success criteria

Phase 2 is successful if:

- symptom timing is coherent
- current admission and prior CPO/ER report are not blended
- current note reads like one encounter, not a merged archive
- last-dose timing is correct
- current objective findings are clearly current

---

# PASS 2 — NOTE GENERATION (FORMATTER ONLY)

## KEY CHANGE

LLM is now ONLY a formatter.

## Role

Render note sections from encounterState only.

## Objective

Generate compact, clinically correct, focused note text without new reasoning.

## Rules

1. Do NOT reason.
2. Do NOT infer.
3. Do NOT add content.
4. Do NOT pull directly from raw sources when encounterState exists.
5. Use ONLY encounterState + deterministic pre-rendered blocks.
6. Do NOT include PHI.
7. Do NOT invent medication doses.
8. Do NOT promote backgroundOnly problems into active assessment.
9. Do NOT flatten timeline incorrectly.
10. Do NOT restate the same fact across multiple sections.
11. In Zaver/assessment: preserve the original diagnosis wording from transcript/doctor alongside the ICD code. Do NOT replace with CSV canonical description. The ICD code validates the diagnosis; the text should reflect what the doctor actually said.
12. Respect per-section render mode: use compact_list (no bullets) for AA and LA; use bullets only where explicitly assigned.

## Behavior

- deterministic output tendency
- same input -> same note
- formatter, not decider

## Note mode

For this pipeline plan, note generation should explicitly support:

- focused_admission_note
- full_outpatient_note
- followup_note
- discharge_note

For the current doctor feedback use case, prioritize:

- focused_admission_note

## Focused admission note rules

### TO / current illness
- current complaint only
- current symptom sequence only
- prior CPO/ER visit only as relevant context

### OA
- include only management-relevant chronic history
- do not dump all past diagnoses
- compress aggressively

### RA / SA / PA / AA / LA / Ab
- concise
- selective
- management-relevant

### Objective
- current encounter findings only
- prior report objective data only if explicitly used as comparison/context

### Assessment / Zaver
- active current problems
- only the most management-relevant chronic relevant conditions
- no encyclopedic historical diagnosis dump
- ICD codes paired with diagnosis text: preserve the doctor's/transcript's original wording alongside the ICD code — do NOT replace original diagnosis text with CSV canonical description. Example: if doctor says "NSTEMI KK I" and ICD is I21.4, output "I21.4 NSTEMI KK I" not "I21.4 Akutny infarkt myokardu inej urcitej lokalizacie"

### Plan
- immediate next steps
- procedure plan
- follow-up logic
- no stale old recommendations unless still current

## Style rules

- concise Slovak hospital style
- compact, clinician-native phrasing
- avoid verbose explanatory narrative
- avoid repeating same fact in multiple sections

## Testing requirements

Must test:

- output shorter than current verbose version
- TO focused on current admission
- OA compressed
- assessment selective
- no PHI
- no title field
- no patient letter logic

---

# PHASE 3 — NOTE-MODE-SPECIFIC RENDERING

## Objective

Teach the system that different templates correspond to different documentation modes.

## Deliverables

Phase 3 MUST implement:

1. explicit noteMode in template/generation logic
2. focused admission-note render rules
3. section render modes (per-section: narrative, bullets, compact_list, verbatim_icd_block)
4. stronger section-specific compression rules
5. compact Slovak hospital style alignment
6. template section ordering conventions — e.g. for focused cardiac: "Anamnézy" is structural heading only (empty content), TO comes first under it
7. ICD + diagnosis text pairing — preserve original diagnosis wording alongside ICD code, do not overwrite with CSV canonical text

## Note modes

Recommended modes:

- focused_admission_note
- full_outpatient_note
- followup_note
- discharge_note

## Section render modes

Introduce deterministic section render modes such as:

- narrative
- bullets
- verbatim_icd_block
- empty
- compact_list (comma-separated or inline, no bullets)

### Default render mode assignments (focused admission note)

- AA (allergies) -> compact_list (NOT bullets — doctor feedback: "alergie bez bulletov")
- LA (medications) -> compact_list (NOT bullets — doctor feedback: "aj LA")
- Zaver / assessment -> verbatim_icd_block
- TO -> narrative
- OA, RA, SA, PA, Ab -> compact_list or narrative (high compression)
- Objective sections -> narrative
- Plan -> bullets

## Focused admission-note compression policy

### High compression
- OA
- RA
- SA
- PA
- Ab

### Medium compression
- TO
- objective prose sections

### Low compression / strict block
- ICD block
- measurements
- vitals
- labs if explicitly shown
- plan/procedure lines

## Success criteria

Phase 3 is successful if:

- note reads like a focused Slovak admission note
- section style matches hospital workflow
- history is compressed appropriately
- output resembles doctor-corrected notes more closely

---

# PASS 2.1 — DEFENSIVE FILTERS

## Role

Catch any leakage or model deviation after rendering.

## Objective

Prevent final persisted output from violating core safety rules.

## Filters

- remove PHI if present
- remove ICD hallucinations
- remove medications not in verified list
- remove background-only diagnoses from assessment if they leaked in
- remove title if unexpectedly generated
- enforce section empties / schema compliance

## Important

Pass 2.1 is NOT the primary control.

It is a defensive backstop.

Primary control must remain upstream deterministic passes.

## Testing requirements

Must test:

- PHI caught if leaked
- ICD hallucination removed
- unverified medication removed
- background-only assessment leak removed
- note schema preserved after filtering

---

# PASS 2.2 — TITLE GENERATION

## Role

Generate short deterministic title from validated diagnoses only.

## Objective

Title should be separate, minimal, and grounded.

## Input

- only validated diagnoses / filtered ICD descriptions

## Rules

- max 6 words
- no hallucination
- no ICD codes in title
- ignore symptom-only codes where policy requires
- no transcript access
- no raw source access

## Fallback policy

If no valid diagnosis exists:

- use explicit deterministic fallback title policy
- document fallback clearly
- do not hallucinate disease name

## Testing requirements

Must test:

- title generated only from diagnosis list
- no ICD code in title
- no raw-source contamination
- no title generated in Pass 2 note renderer

---

# PHASE 4 — REVIEW LAYER + DOCTOR CALIBRATION

## Objective

Add a controlled reviewer step and structured feedback loop.

## Deliverables

Phase 4 MUST implement:

1. optional post-render reviewer
2. issue taxonomy
3. one-pass rerender if reviewer fails
4. gold-note library from doctor-corrected notes
5. doctor-specific compression/stylistic calibration rules

## Reviewer scope

The reviewer should flag only high-value issues:

- medication_hallucination
- timeline_error
- prior_report_overcopy
- irrelevant_history_overload
- phi_leak
- assessment_overload

## Reviewer rules

1. Reviewer compares rendered note against encounterState.
2. Reviewer outputs structured JSON only.
3. If reviewer fails, system may rerender once with reviewer issues injected.
4. No infinite review/regenerate loops.

## Gold-note library

Doctor-corrected outputs should be stored as:

- mode examples
- compression examples
- ordering examples
- relevance-threshold examples

Use them to calibrate:
- what belongs in TO
- what belongs in OA
- what belongs in Zaver
- how compact sections should be

Do NOT use them to weaken grounding rules.

## Success criteria

Phase 4 is successful if:

- reviewer catches the main physician complaints
- rerender improves quality without drift
- outputs converge toward doctor-corrected style
- system remains deterministic and explainable

---

# PHASE-BY-PHASE BUILD ORDER

## Recommended implementation order

### Phase 1
Build first:
- Pass 1.1 PHI scrub
- Pass 1.6 medication normalization
- assessment relevance classification inside Pass 1.8
- Pass 2 admission-note constraints
- Pass 2.1 defensive scrub

### Phase 2
Build next:
- Pass 1.2 source tagging
- Pass 1.7 timeline structuring
- strengthen Pass 1.8 encounter state

### Phase 3
Build next:
- noteMode support
- render modes
- focused admission compression policy

### Phase 4
Build last:
- reviewer
- doctor gold-note calibration
- one-pass rerender with reviewer issues

---

# SUCCESS CRITERIA

System is correct when:

- No medication hallucinations occur
- Timeline is chronologically correct
- OCR does not override transcript incorrectly
- ICD list is minimal and relevant
- No PHI appears in output
- Notes reflect clinical reasoning, not transcript order
- Assessment remains compact and current
- Prior reports appear as context, not copied truth
- Regeneration produces stable output
- Doctor-edited note delta becomes materially smaller

---

# TEST PLAN

## Unit tests

### Pass 1.1
- PHI replacement
- clinical date preservation
- repeated identifier replacement

### Pass 1.2
- correct source tagging
- doctor_notes priority
- prior report treated as prior

### Pass 1.3
- no inference
- evidence always present
- uncertainty preserved

### Pass 1.4
- evidence grounding
- source correction
- dedup logic

### Pass 1.5
- correction phrase handling
- no collapse of valid repeated measurements

### Pass 1.6
- no invented medication dose
- conflicting dose remains uncertain
- structured OCR list used correctly

### Pass 1.7
- relative time normalization
- prior visit vs current encounter separation

### Pass 1.8
- activeCurrent vs chronicRelevant vs backgroundOnly vs uncertain
- compact assessment selection

### Pass 2
- no title field
- no patient letter
- uses encounterState only
- no extra facts added

### Pass 2.1
- leaked PHI removed
- hallucinated ICD removed
- unverified med removed

### Pass 2.2
- title only from validated diagnoses
- no ICD codes in title

## Integration tests

Use the doctor feedback case as a regression suite:

Expected behavior:
- no PHI
- compact OA
- safer LA
- correct symptom timeline
- prior CPO report used as prior context only
- current assessment limited to current cardiac problem + key comorbidities

---

# FINAL OPERATING PRINCIPLES

## Principle 1
The LLM should never decide WHAT is true.
It should only decide HOW to format truth.

## Principle 2
If data is conflicting, the system must reduce specificity — not increase it.

## Principle 3
If a prior report and current transcript disagree, current encounter truth wins unless explicitly overridden.

## Principle 4
If a medication is uncertain, omit detail rather than hallucinate it.

## Principle 5
If a diagnosis is background-only, it must not appear in active current assessment.

## Principle 6
If PHI is not required for the product output, it must be removed before LLM reasoning.

## Principle 7
Focused admission note is a distinct note mode, not a generic summary.

---

# FINAL PRINCIPLE

> The LLM should never decide WHAT is true.
> It should only decide HOW to format truth.
