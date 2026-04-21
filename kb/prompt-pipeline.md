# MediTalk Prompt Pipeline — Deep Dive

_Last updated: 2026-04-21 (section-agent architecture: deleted `clinical/` folder, `anthropic.ts`, fact-extraction/validation/resolution/ICD-certainty pipeline. One generic agent per section now, with the admin-editable `section.context` as the clinical contract.)_

How raw clinical data becomes a structured medical note. For data intake (recording, transcription, file upload, doctor notes), see [data-extraction.md](data-extraction.md).

Read this before touching anything in [web/src/app/api/generate/route.ts](../web/src/app/api/generate/route.ts), [web/src/app/api/regenerate/route.ts](../web/src/app/api/regenerate/route.ts), [web/src/lib/sections/](../web/src/lib/sections/), or [web/src/lib/lookup/](../web/src/lib/lookup/).

---

## 0. Pipeline Overview

The entire pipeline is a tight loop. The template's sections are the spine; each section has an admin-editable `context` string that IS the clinical contract for the agent rendering it.

```
              INPUTS
               |
  transcript + files + doctor notes
               |
  Stage 1      scrubPhi                          pure TS
               -> remove patient name, birth number, phone, email, addresses
               |
  Stage 2      generateNote(template, source)    sections/pipeline.ts
               |
               for each LEAF section in template (depth-first, template order):
                 |
                 Stage 2a  renderSection          sections/section-agent.ts
                           -> one Anthropic call, Haiku by default
                           -> system prompt = section.context + prior-section outputs
                           -> user message  = { transcript, doctorNotes, files[] }
                 |
                 Stage 2b  reconcilers[]          sections/reconcilers/
                           -> optional per-section post-render helpers
                           -> registered by string key, referenced from template
                 |
                 Stream:    onSection callback fires -> SSE `section` event -> UI
               |
               done
               |
  Stage 3      buildTemplateHtml                  templates/html.ts
               -> concat sections in template hierarchy -> final HTML
```

No fact extraction. No EncounterModel. No deterministic section renderers. No specialty pack. No Sonnet Pass 1, no Haiku Pass 1.5, no ICD certainty filter. The only things standing between the raw source and the rendered note are (a) PHI scrub, (b) one Claude call per leaf section, (c) optional reconcilers.

Clinical knowledge lives in exactly two places:

1. **`section.context`** — free-text clinical contract, per section, per template, edited in the admin UI. This is the alpha and omega of per-section behavior.
2. **`sections/reconcilers/`** — small, pure TypeScript helpers for quality checks that can't be expressed in a prompt (drug-name canonicalization, ICD code validation, BP range sanity, etc.). Referenced by `section.reconcilers: string[]` in the template and registered in `reconcilers/index.ts`.

---

## 1. Key Files

### Pipeline

| File                                                                                        | Role                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`web/src/lib/sections/pipeline.ts`](../web/src/lib/sections/pipeline.ts)                   | Orchestrator. Walks the template tree, renders leaves in order, fires `onSection` per completed section.                                                                          |
| [`web/src/lib/sections/section-agent.ts`](../web/src/lib/sections/section-agent.ts)         | The generic section-agent function — one Anthropic call per section, builds system prompt from `section.context` + prior-section outputs, pipes output through named reconcilers. |
| [`web/src/lib/sections/reconcilers/index.ts`](../web/src/lib/sections/reconcilers/index.ts) | Registry of named post-render helpers. Start empty; add as needed.                                                                                                                |

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

A reconciler is a small, pure TS function with the signature:

```ts
type Reconciler = (text: string, source: RawSource) => string;
```

Reconcilers post-process a section's rendered text. Registered by string key in [`sections/reconcilers/index.ts`](../web/src/lib/sections/reconcilers/index.ts). Referenced from the template as `section.reconcilers: ["drug-normalizer", …]`.

None are registered yet. First candidates (when quality demands it):

- **`drug-normalizer`** — canonicalize drug brand names against the medication CSV, fold "Paretin"/"Paretic" style variants.
- **`icd-validator`** — validate ICD codes emitted in Záver against the localized ICD-10 CSV; replace hallucinated descriptions with canonical ones.
- **`bp-sanity`** — check that blood pressure values are physiologic (50–250 systolic, etc.).

Keep them tiny and orthogonal.

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

- **Section rendered empty** — check the `context`: did the rule "return empty string when nothing in source fits" fire unexpectedly? Did the prior-sections context claim all the candidate content?
- **Section content leaking between sections** — tighten the `NEVER include X here` wording in both sections' contexts.
- **Wrong dose/drug name in LA** — add `drug-normalizer` reconciler (not yet registered).
- **Hallucinated ICD in Záver** — add `icd-validator` reconciler. Or tighten the Záver context to require verbatim code+description from the source.
- **Slow generation** — most sections should be on Haiku. Check that `section.model` isn't accidentally set to `opus` template-wide.
