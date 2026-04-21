# MediTalk Prompt Pipeline — Deep Dive

_Last updated: 2026-04-21 (corpus-driven style, deterministic preprocessor, ICD suggester drives Záver. Older milestones in commit history.)_

How raw clinical data becomes a structured medical note. For data intake (recording, transcription, file upload, doctor notes), see [data-extraction.md](data-extraction.md).

Read this before touching anything in [web/src/app/api/generate/route.ts](../web/src/app/api/generate/route.ts), [web/src/app/api/regenerate/route.ts](../web/src/app/api/regenerate/route.ts), [web/src/lib/sections/](../web/src/lib/sections/), or [web/src/lib/lookup/](../web/src/lib/lookup/).

---

## 0. Pipeline Overview

Four layers sit between the raw source and the rendered note: PHI scrub (deterministic regex), the structured-facts preprocessor (deterministic regex over transcript/doctorNotes/files), per-section LLM calls (Haiku, each with a strict contract + corpus-derived few-shot), and post-render reconcilers. Záver is special — it's populated from the ICD suggester's output, not an LLM section agent.

```
              INPUTS
               |
  transcript + files[{text, context?}] + doctorNotes
               |
  Stage 1      scrubPhi                              pure TS (regex)
               -> patient name (when known), rodné číslo, phone, email,
                  PSČ+city, slash-notation addresses
               |
  Stage 2      preprocessSource                      sections/source-preprocessor.ts
               -> scans EVERY carrier (transcript/doctorNotes/files[])
               -> extracts OCR med blocks, vital lines, EKG readings,
                  transcript brand mentions
               -> dedupes meds by leading-letter prefix
               -> pulls loose HR from "SF 70/min" inside EKG text
               -> appends <STRUCTURED_FACTS> block to transcript
               |
  Stage 3      parallel:
               |      suggestIcdCodes (source-only mode)         sections/suggest-icd.ts
               |      -> Haiku, 10–15 CSV-validated ICD candidates
               |      -> ranked by relevance, primary first
               |      -> optional `differential` on symptom-code primary
               |
               |      generateNote(template, source)              sections/pipeline.ts
               |      -> walks template leaves in order
               |      -> SKIPS Záver leaf (fed by suggester)
               |      -> per leaf:
               |           renderSection                          sections/section-agent.ts
               |           -> Haiku call
               |           -> system prompt: role + worldview + corpus examples + contract
               |           -> user message: source (transcript + <STRUCTURED_FACTS>,
               |              doctorNotes, files with "Doctor's focus: …" when context set)
               |           reconcilers[]                          sections/reconcilers/
               |           -> post-render transforms
               |           -> SSE onSection fires → UI stream
               |
  Stage 4      inject Záver from suggester           sections/format-zaver.ts
               -> formatZaverFromSuggestions(codes)
               -> "primary [optional (diferenciálna dg.: …)], secondaries, …"
               -> written to sectionContentsMap[zaverId]
               -> synthetic SSE section event fires
               |
  Stage 5      buildTemplateHtml                     templates/html.ts
               -> concat sections in template hierarchy -> final HTML
               -> skipEmpty drops blank subsections
```

Clinical knowledge lives in four places:

1. **`template.styleExamples`** (jsonb) — real attending reference notes. The corpus. [`lib/templates/reference-notes.ts`](../web/src/lib/templates/reference-notes.ts) parses them per-section at generation time and injects up to 3 per-section snippets as few-shot voice examples. Style, tone, phrasing emerge from the corpus, not from prompt rules.
2. **`template.systemPrompt`** — template-wide guardrails (specialty worldview, abbreviation conventions). Injected once per section-agent call.
3. **`section.context`** — per-section contract (OWNS / NEVER OWNS / NO INVENTION / WHEN EMPTY). Short; format/voice prescriptions live in the corpus instead.
4. **`sections/reconcilers/`** — post-render helpers. Registered by string key in [`reconcilers/index.ts`](../web/src/lib/sections/reconcilers/index.ts); referenced from `section.reconcilers: string[]`.

---

## 1. Key Files

### Pipeline

| File                                                                                              | Role                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`web/src/lib/sections/pipeline.ts`](../web/src/lib/sections/pipeline.ts)                         | Orchestrator. Runs the preprocessor once, builds the per-section corpus map, walks template leaves in order, **skips the Záver leaf** (label-matched — it's fed by the suggester). `findZaverSection` helper exported.    |
| [`web/src/lib/sections/section-agent.ts`](../web/src/lib/sections/section-agent.ts)               | Generic section-agent — one Anthropic call per section. System prompt layers: role + worldview + `# Voice examples` (corpus) + section contract. User message: source with `# File: … (Doctor's focus: …)` when set.      |
| [`web/src/lib/sections/source-preprocessor.ts`](../web/src/lib/sections/source-preprocessor.ts)   | Deterministic regex pass over every source carrier. Extracts OCR med blocks, vital lines, EKG readings, transcript brand mentions. Dedupes meds by prefix. Emits `<STRUCTURED_FACTS>` XML the agents see alongside source. |
| [`web/src/lib/sections/suggest-icd.ts`](../web/src/lib/sections/suggest-icd.ts)                   | One-shot Haiku call: source → 10–15 CSV-validated ICD-10 candidates (ranked). Output powers BOTH the right-side "Navrhované kódy" panel AND the Záver section.                                                           |
| [`web/src/lib/sections/format-zaver.ts`](../web/src/lib/sections/format-zaver.ts)                 | Deterministic formatter: `SuggestedIcdCode[]` → Záver line ("primary [differential], secondaries, …").                                                                                                                   |
| [`web/src/lib/templates/reference-notes.ts`](../web/src/lib/templates/reference-notes.ts)         | Parses `template.styleExamples` (full attending notes) into per-section snippet buckets via label matching. Round-robin selects 3 per section. Feeds `# Voice examples` block.                                            |
| [`web/src/lib/sections/reconcilers/index.ts`](../web/src/lib/sections/reconcilers/index.ts)       | Registry: `drug-normalizer`, `icd-validator`. Each reconciler has signature `(text, source, { language }) => string`.                                                                                                     |

### Routes

| File                                                                            | Role                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`web/src/app/api/generate/route.ts`](../web/src/app/api/generate/route.ts)     | POST `/api/generate`. Auth → audio recovery → file extraction → PHI scrub → `generateNote` → save + SSE stream.                                                                                                           |
| [`web/src/app/api/regenerate/route.ts`](../web/src/app/api/regenerate/route.ts) | POST `/api/regenerate`. Auth → load cached raw source from visit metadata → `generateNote` → save + SSE stream. No special "rerender" / "reformat" paths anymore — both collapse into "rerun with possibly-new template". |

### Utilities

| File                                                                        | Role                                                                                          |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [`web/src/lib/phi-scrubber.ts`](../web/src/lib/phi-scrubber.ts)             | Deterministic PHI scrub. Runs once on raw source before any LLM call.                         |
| [`web/src/lib/lookup/icd.ts`](../web/src/lib/lookup/icd.ts)                 | ICD-10 CSV loader + `searchIcd` / `resolveIcdCodes` for admin panels. Not used in generation. |
| [`web/src/lib/lookup/medications.ts`](../web/src/lib/lookup/medications.ts) | Medication CSV loader + `searchMedications` for admin panels. Not used in generation.         |
| [`web/src/lib/templates/html.ts`](../web/src/lib/templates/html.ts)         | `buildTemplateHtml` concatenates rendered section contents into the final HTML note.          |

---

## 2. The Section Contract (`section.context`)

Stored in `templates.sections[].context` as plain text. Admin-editable per template. Example:

```
ALL medications — both chronic home medications AND medications administered
during this encounter (Heparin, Aspirin, morphine, etc. given by ambulance or in ED).

List ALL medications ONLY here, NEVER in OA, HPI, or any other section.

Format:
- One medication per line.
- Include dose and frequency whenever the source provides them.
- Preserve Slovak dose-frequency notation verbatim ("1-0-1", "ráno a večer").
- Use the brand name the doctor actually wrote.
- Drop any negated or discontinued medication.
```

The agent sees this as part of its system prompt together with:

- The section title and the target language.
- All previously-rendered sections in the same generation (so it knows what's already been claimed and avoids duplication).
- A universal rule block: only facts present in the raw source, preserve wording/dosage, empty string when nothing fits.

### Cross-section consistency

The agent receives prior-rendered sections as context. That's how we prevent the LA list from reappearing in OA and vice-versa. Explicit exclusion wording in each `context` reinforces this:

> "NEVER include medications or drug names here — those belong to LA."

This is the ONLY consistency mechanism; there is no shared "facts" layer.

---

## 3. Per-section Model Selection

Every section carries `section.model: "haiku" | "sonnet" | "opus"` (defaults to `haiku`). Most sections (structured lists, vitals, allergies) work great on Haiku and finish in ~1–2s each. Narrative-heavy sections (TO/HPI, Záver, Plan) can be upgraded to Sonnet or Opus per-template if quality demands it.

Model IDs live in [`section-agent.ts`](../web/src/lib/sections/section-agent.ts) under `MODEL_IDS`.

---

## 4. Reconcilers

Reconcilers are pure TS post-render transforms:

```ts
type Reconciler = (
  text: string,
  source: RawSource,
  ctx: { language: Language },
) => string;
```

Registered in [`sections/reconcilers/index.ts`](../web/src/lib/sections/reconcilers/index.ts). Attached to sections via `section.reconcilers: string[]` — set by [`web/scripts/enable-reconcilers.mjs`](../web/scripts/enable-reconcilers.mjs) (idempotent, label-matched).

| Name               | Runs on                 | Behaviour                                                                                                                                                                                                                                                                                                 |
| ------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drug-normalizer`  | LA / medication sections | Extracts the leading drug-name prefix from each comma-separated entry, short-circuits through `ABBREVIATION_ALIASES` (e.g. `ANP → ANOPYRIN`), then fuzzy-corrects against the medication CSV if no alias hit. Preserves dose/frequency verbatim.                                                       |
| `icd-validator`    | Záver (legacy path)    | Code-boundary splitter (not comma-based — a canonical description with internal commas no longer doubles). Per code: CSV hit → canonical description; 1-2 decimal digit miss with valid root → downgrade; ICD-10-CM shape (≥3 decimal digits) + no CSV → drop. **Note:** Záver is now fed by the suggester directly; this reconciler is a safety net if a template still routes output through it. |

**Absence stripper** is built into `renderSection` itself, not a registered reconciler. Catches "V surových zdrojoch…", "(empty)", "Žiadne údaje…" patterns and replaces with `""`. See `isAbsenceDescription` in `section-agent.ts`.

---

## 4.5 Reference-notes corpus + ICD suggester

### Corpus (`template.styleExamples`)

Admins attach real attending notes to a template via the template editor's "Reference Notes Corpus" panel (admin). Upload hits [`admin/app/api/templates/analyze-note/route.ts`](../admin/app/api/templates/analyze-note/route.ts) which extracts text (PDF/image/plain), PHI-scrubs via [`admin/lib/phi-scrubber.ts`](../admin/lib/phi-scrubber.ts), and returns a `proposedExample` plus the analyzer's detected sections. Preview shows per-section capture (done client-side via [`admin/lib/reference-notes-parser.ts`](../admin/lib/reference-notes-parser.ts)) before save.

At generation time, `buildSectionExamplesMap` parses every attached note into per-section snippets using the template's own labels (flat label index, diacritic-stripped, case-insensitive). Each section-agent receives up to 3 snippets as the `# Voice examples` block in its system prompt — explicit instruction: "mimic the TONE and STRUCTURE, never copy patient-specific facts".

Future: same ingestion path will power doctor-facing "upload your own notes → personal template" flow. No code change needed, just a new UI.

### ICD suggester

[`suggest-icd.ts`](../web/src/lib/sections/suggest-icd.ts) runs ONCE per generation, in parallel with section rendering. Source-only mode (sections array empty) is used today; `sections` parameter is still plumbed through for a future "re-suggest from final note" flow.

Output feeds two places:

1. **Right-side panel** — persisted to `visit.metadata.clinical_analysis.suggestedIcdCodes`. [`IcdPanelContent`](../web/src/components/encounters/icd-panel.tsx) reads it and renders the ranked list with per-code confidence.
2. **Záver section** — [`formatZaverFromSuggestions`](../web/src/lib/sections/format-zaver.ts) joins the codes into a comma-separated line. Primary first; if the primary is a symptom code (R07.4, R06.0, etc.) the suggester provides a `differential` field which gets rendered as `(diferenciálna dg.: …)`. Injected into `sectionContentsMap[zaverId]` before HTML build; a synthetic SSE `section` event fires so the streaming UI shows it.

Every code is CSV-validated inside the suggester. CM-shaped codes (≥3 decimal digits) not in the Slovak CSV are dropped. Codes with unknown roots are dropped. "Low" confidence codes are excluded from Záver but still surface in the right-panel for the doctor.

---

## 5. Streaming

The route creates an SSE stream. Each time `generateNote` finishes a section it fires `onSection`, which in turn emits `{ type: "section", id, title, content }`. The existing client-side SSE handling is unchanged.

Sections stream in template order (depth-first). Haiku latency per section is ~1–2s; a 15-section note typically finishes in ~20–30s wall time.

---

## 6. Regenerate Path

Regenerate is nearly identical to generate. Differences:

- No audio recovery, no inline file extraction — the visit already has `metadata.transcript`, `metadata.doctor_notes`, and `metadata.files[].extracted_text` cached.
- Reads raw source from metadata, runs the same pipeline.
- All former branches (fact-based rerender, prose reformat, full Opus) collapsed into a single "run with possibly-new template" flow.

---

## 7. What's Intentionally NOT in the Pipeline Anymore

| Removed                                                                 | What it did                                                    | Why it's gone                                                                                                      |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Sonnet clinical-analysis Pass 1                                         | Inferred specialty, matched concepts, suggested ICD candidates | Non-deterministic; replaced by deterministic section contracts + reconcilers.                                      |
| Haiku fact-extraction Pass 1.5                                          | 15-category structured facts with source evidence              | Sections now read raw source directly, nothing is pre-filtered out.                                                |
| Fact validator / resolver / timeline                                    | Drop ungrounded / self-corrected / time-conflicting facts      | No facts → no fact pipeline.                                                                                       |
| Diagnosis resolver + synonym table                                      | Deterministic ICD resolution from diagnosis facts              | Záver section now emits ICD codes directly from raw source. If quality demands, add an `icd-validator` reconciler. |
| ICD certainty filter                                                    | Drop ICD candidates not lexically grounded in facts            | Same — reconciler-level concern, not a pipeline stage.                                                             |
| EncounterModel                                                          | Single source of truth for bucketed facts / problems           | Replaced by: source + prior rendered sections = all an agent needs.                                                |
| Deterministic section renderers (medications, vitals, assessment, etc.) | Format structured slots without LLM                            | Each section is now an LLM call. If determinism is critical for a given section, add a reconciler.                 |
| Specialty pack                                                          | Per-language, per-specialty prompt variants                    | Templates themselves are per-specialty; pack lives in the template's system prompt + each section's context.       |
| `generateFromTemplate` / `anthropic.ts`                                 | 1,200-line monolithic two-pass generation                      | Replaced by ~200 lines across `pipeline.ts` + `section-agent.ts`.                                                  |

See the commit history if you need to understand why a specific piece was removed.

---

## 8. Adding a New Section

1. In the template editor (admin UI), add a section: id, label(s), `context`.
2. Pick a model (defaults to Haiku; override only if clearly needed).
3. (Optional) add reconcilers by string key.
4. Save. The next generation uses it. No code change, no deploy.

---

## 9. Debugging

- **Section rendered empty** — check the `context`: did the "output ZERO characters" rule fire? Check the preprocessor log `[pipeline] preprocessor extracted N meds, …` — if the facts aren't there, the section has nothing to render.
- **Section content leaking between sections** — tighten the `NEVER OWNS` list in both sections' contexts. The preprocessor's `<STRUCTURED_FACTS>` block often resolves this better than prose rules.
- **Wrong dose/drug name in LA** — the `drug-normalizer` alias map in [`reconcilers/drug-normalizer.ts`](../web/src/lib/sections/reconcilers/drug-normalizer.ts) catches known Slovak shortforms (ANP, ASA, NTG). Add to `ABBREVIATION_ALIASES` when a new one surfaces.
- **Hallucinated / wrong ICD in Záver** — Záver is fed by the suggester, not a section agent. Tighten the suggester's prompt in [`suggest-icd.ts`](../web/src/lib/sections/suggest-icd.ts) or confirm the ICD CSV has the right subcode.
- **Cascade-shift in rendered note** — section content appears under the wrong heading: the culprit is [`parseNoteToSectionMap`](../web/src/lib/parse-note-sections.ts). It must match by label, not by index. Tested in `parse-note-sections.test.ts`.
- **Agent output doesn't sound like an attending** — the template needs a corpus. Upload 2–5 real notes via the admin template editor's Reference Notes Corpus panel.
- **Slow generation** — most sections run on Haiku. Check `section.model`; worldview + per-section context + corpus snippets bloat the input tokens — aim for ≤3 corpus snippets per section (hard-capped in `buildSectionExamplesMap`).
