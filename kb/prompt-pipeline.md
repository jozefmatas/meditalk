# MediTalk Prompt Pipeline — Deep Dive

_Last updated: 2026-04-23 (Anthropic tool-use on critic / suggester / adjust-router / file-focus; section-agent stays on free-text prose output. Claims-with-evidence variant was tried and reverted — it atomised prose + dropped compact clinical shorthand).)_

How raw clinical data becomes a structured medical note. For data intake (recording, transcription, file upload, doctor notes), see [data-extraction.md](data-extraction.md).

Read this before touching anything in [web/src/app/api/generate/route.ts](../web/src/app/api/generate/route.ts), [web/src/app/api/regenerate/route.ts](../web/src/app/api/regenerate/route.ts), [web/src/app/api/adjust/route.ts](../web/src/app/api/adjust/route.ts), [web/src/lib/sections/](../web/src/lib/sections/), or [web/src/lib/lookup/](../web/src/lib/lookup/).

---

## Tool-use rollout status (2026-04-23)

Four of the five Haiku calls in the pipeline now use `tool_choice: { type: "tool", name: ... }` to force structured output with server-side validation. The fifth (section-agent) stays on free-text prose because structured "claims" output broke prose formatting.

- **`renderSection`** (`sections/section-agent.ts`) — **FREE-TEXT**. Reads the source + section contract and emits prose directly. `isAbsenceDescription` (exported from the same file) strips "(empty)" / "žiadne údaje" / essay-describing-absence leaks before the content reaches the UI. Grounding is enforced downstream by the critic pass.
  - _Why not claims-with-evidence?_ Attempted a tool-use version that returned `{claims: [{text, evidence, kind}]}` with per-claim server-side substring validation. Two problems emerged: (1) each claim rendered as its own `<p>`, destroying compact single-paragraph sections like OA / LA (which use comma-separated Slovak clinical shorthand); (2) extraction became too conservative, dropping specifics like "sy námahovej AP CCS II" or "DLP" that were plainly in the source. Reverted.
- **`criticPass`** (`sections/critic.ts`) — forces `submit_corrected_section` returning `{corrected: string}`. The model has no text channel to leak essays, meta-commentary, or "The correct AA section is:" prefixes. Empty-section = pass `""`. Accepts an optional `model: "haiku" | "sonnet"` tier. **Sonnet 4.6 is the default for every section EXCEPT LA**; LA stays on Haiku. Rationale:
  - Sonnet's tighter grounding pays off for narrative + reasoning sections: AA denial discrimination (catches "Myslím, že nie" as a denial), OA shorthand preservation, Záver ICD inference (I21.2 lateral over I21.9, I34.0 over I35.x, D47.2 MGUS), TO narrative synthesis, EA silence-vs-denial.
  - LA (medication list) penalises Sonnet's strictness: Sonnet's critic aggressively strips meds it considers "not today's prescription" (observed in eval: Rytmonorm, Nolpaza dropped when OCR lists them as chronic meds). For a med list where completeness matters more than strict grounding, Haiku's more forgiving behaviour is correct.
  - Routing is a single line in `pipeline.ts`: `isLaTitle(config.title) ? "haiku" : "sonnet"`. Easy to iterate on per-section overrides if other sections show similar completeness-over-strictness trade-offs.
  - Cost: ~$0.10-0.15/visit extra for broader Sonnet coverage. Latency: unaffected — critic calls run in parallel per section, and Sonnet was already on the critical path for Záver/OA.
  - Eval: bumped from 76/84 baseline → 79-81/84 across two runs. All remaining failures are eval-assertion brittleness (`"Malc"` vs "Malackách", `"AH"` case-sensitive, `"štítn"` vs "strumektómia") rather than content quality.
- **`suggestIcdCodes`** (`sections/suggest-icd.ts`) — forces `submit_icd_candidates` returning `{codes: [{code, description, confidence, evidence, differential?}]}`. Evidence is ONE contiguous verbatim substring (≥4 chars); concatenation with joiners is banned. Server validates CSV membership, evidence-in-source, and dedups by code.
- **`routeAdjustment`** (`sections/adjust-router.ts`) — forces `select_affected_sections` returning `{affected: string[], reasoning?: string}`. Returns the subset of leaf section ids a mid-visit adjustment touches. No JSON regex parsing.
- **`extractWithDirective`** (`sections/file-focus.ts`) — forces `submit_extracted_passages` returning `{passages: [{text, match_reason?}]}`. Each passage is a verbatim substring of the document; server validates and drops anything that can't be substring-matched in the original file.

### What got removed

- `stripBoilerplateExam` + `EXAM_BOILERPLATE_PATTERNS` — obsolete: the critic tool-use pass enforces the same contract more precisely.
- `stripUngroundedVitalValue` + `toSlovakNumberForms(0..999)` — obsolete: the critic handles speech→digit paraphrase checks via its prompt + forced tool output.
- `extractEssayAnswer` + the post-critic regex extractor — obsolete once critic returns a single string field via tool call.
- The transient `USE_CLAIMS_AGENT` / `SECTION_AGENT_TOOL_USE` env flags and the `section-agent-claims.ts` spike file.

`isAbsenceDescription` was kept — the free-text section-agent still needs it.

### Prior session items still in force

- **`/api/adjust`** — incremental re-render endpoint. Client sends only the delta. The Haiku router classifies affected leaves; `generateNote` re-renders only those via `leafIdFilter`; untouched sections keep their prior content from `visit.metadata.section_contents`. Vital-group atomicity: flagging any of Krvný tlak / Pulz / Výška / Hmotnosť / BMI / EKG / Celkové vyšetrenie re-renders the whole group.
- **File-focus cache** — `visit.metadata.file_focus_cache` keyed on `(fileId, textHash, directive)` so unchanged files skip re-filtering.
- **Critic enabled on every leaf** (214 sections) via `scripts/enable-critic-everywhere.mjs`. Záver keeps its own critic call from the route.
- **Template guardrails**: objective-exam grounding, clinical-voice 3rd-person, Slovak grammar rules (via scripts).
- **Section contract tightenings**: TO, LA, Pulz, Výška/Hmotnosť/BMI, Celkové vyšetrenie, EA (via scripts).
- **Záver line formatting**: `formatZaverFromSuggestions` emits each ICD on its own line; `renderContent` wraps each line in its own `<p>`.
- **Eval harness**: 3 real doctor-corrected fixtures (`mordavska-nstemi`, `kovacikova-real`, `gozora-stemi`). Diacritic-fold matching, `EVAL_VERBOSE=1` dumps full notes.
- **UI: Actual / Past radio** in `file-context-dialog.tsx` — "Actual" = use whole file, "Past" = type a directive to distill.
- **ICD panel dedup** — server + UI dedup by code.

---

## Adding a new locale or specialty — what to touch

This section answers the question: _"We ship sk + cardiology today. What do I update to ship cs / de / fr, or neurology / psychiatry / internal?"_ The table below maps every locale- or specialty-coupled surface in the codebase. Rule of thumb: the bulk of the system's intelligence is in **per-template data** (section contracts + voice corpus + template system prompt), which is admin-editable and needs no code change. Everything else is either structurally portable or hand-maintained in a small number of files.

### Auto-portable (no code change, no prompt tweak)

| Surface | Why it's portable |
|---|---|
| Source-substring grounding (critic + suggester evidence validation) | Works on any UTF-8 text; diacritic-folded |
| Tool-use schemas (`submit_corrected_section`, `submit_icd_candidates`, `select_affected_sections`, `submit_extracted_passages`) | Schema only, no locale in field shape |
| `stripUngroundedVitalValue` (Pulz / TK / Výška / Hmotnosť / BMI / EKG guard) | Arabic digits only — language-agnostic |
| `/api/adjust` router + file-focus filter | Model-level classification; no hardcoded language strings |
| PHI scrub (patient name, phone, email) | Regex patterns are structurally locale-neutral (SK-specific rodné číslo is an edge addition) |

### Admin-editable per-template (no code change, but content work)

| Surface | What to update |
|---|---|
| `section.context` — per-section clinical contract | Translate the contract; keep the OWNS / NEVER OWNS / FORMAT / LIMITS structure |
| `template.systemPrompt` — template-wide guardrails | Translate worldview, abbreviation conventions, locale grammar rules |
| `template.styleExamples` — voice corpus | Replace with locale's attending-note excerpts (style bible) |
| `section.labels` — per-locale headings | Add the new locale key (sk / cs / en / …) to every section's `labels` map |
| `section.model` — Haiku / Sonnet / Opus tier | Usually unchanged; bump to Sonnet if locale struggles on Haiku |

All four live in `templates` table rows. Use `web/scripts/*.mjs` migration patterns to ship template changes.

### Hand-maintained (code change required)

| Surface | File | What changes for a new locale | What changes for a new specialty |
|---|---|---|---|
| `isAbsenceDescription` regex patterns | [`web/src/lib/sections/section-agent.ts`](../web/src/lib/sections/section-agent.ts) | Add locale-specific "no data" phrasings (e.g. German "keine Angabe", French "non renseigné") | Usually none |
| Critic prompt — paraphrase examples ("cukrovka → DM") | [`web/src/lib/sections/critic.ts`](../web/src/lib/sections/critic.ts) | Add locale paraphrase pairs (German "Zucker → DM", French "sucre → DT") | Specialty-specific paraphrases if any |
| Critic prompt — unfounded-denial examples ("Alkohol neguje", "Infekčné ochorenie neguje") | [`web/src/lib/sections/critic.ts`](../web/src/lib/sections/critic.ts) | Translate denial patterns to target locale | Typically none — denials are cross-specialty |
| Critic prompt — boilerplate traps ("Pacient pri vedomí", "Habitus štíhly") | [`web/src/lib/sections/critic.ts`](../web/src/lib/sections/critic.ts) | Locale's common boilerplate phrases | Specialty-specific exam boilerplate (e.g. neurology "reflexy sym. prítomné") |
| Suggester prompt — ICD code knowledge (MI anatomy, F17.2, I48.0 specifics) | [`web/src/lib/sections/suggest-icd.ts`](../web/src/lib/sections/suggest-icd.ts) | ICD codes are WHO-global; locale only affects description text | **Big specialty work**: add neurology / psychiatry / internal ICD traps and primary-code rules |
| `LANGUAGE_LABEL` maps (`{ sk: "Slovak", ... }`) | `section-agent.ts`, `critic.ts`, `suggest-icd.ts`, `file-focus.ts`, `adjust-router.ts` | Add the new locale entry to all five maps | None |
| `SupportedLanguage` type + `normalizeLanguage` | [`web/src/lib/types.ts`](../web/src/lib/types.ts), `pipeline.ts` | Add the new ISO code to the union | None |
| `STRUCTURAL_VITAL_LABELS` + `EXAM_NARRATIVE_LABELS` (normalised label sets) | [`web/src/lib/sections/pipeline.ts`](../web/src/lib/sections/pipeline.ts) | Add locale's label spellings (e.g. German "Größe", "Gewicht"; French "Taille", "Poids") | Add specialty-specific sections if they need the same voice-example skip treatment |
| `ZAVER_LABELS` (recognised conclusion labels) | [`web/src/lib/sections/pipeline.ts`](../web/src/lib/sections/pipeline.ts) | Add locale's "Assessment" / "Závěr" / "Fazit" / "Conclusion" variants | None |
| ICD CSV lookup data | `web/src/lib/lookup/icd/*.csv` | Ship the locale's WHO ICD-10 CSV (SK, CS, EN already shipped) | None — codes are specialty-agnostic at the catalog level |
| i18n message bundles | `web/messages/{sk,cs,en}.json` | Add new locale JSON | None |
| Next-intl routing config | [`web/src/i18n/routing.ts`](../web/src/i18n/routing.ts) | Add new locale to `locales` list | None |
| `next-intl` `localePrefix` strategy | [`web/src/i18n/routing.ts`](../web/src/i18n/routing.ts) | Usually unchanged (`as-needed` works for any set) | None |
| PHI scrub — locale-specific IDs (SK/CZ rodné číslo, German Versicherungsnummer, etc.) | [`web/src/lib/phi-scrub.ts`](../web/src/lib/phi-scrub.ts) | Add the locale's national ID regex + guards | None |
| ElevenLabs Scribe transcription prompt hints | [`web/src/lib/elevenlabs.ts`](../web/src/lib/elevenlabs.ts) | The `language_code` param already accepts any locale Scribe supports — verify ISO-639 code | None |

### Checklist — adding a new locale (e.g. `de`)

1. **Types + routing**: extend `SupportedLanguage`, `normalizeLanguage`, `LANGUAGE_LABEL` (5 files), add `de` to `next-intl` routing, ship `web/messages/de.json`.
2. **ICD CSV**: drop the German WHO ICD-10 CSV into `web/src/lib/lookup/icd/`.
3. **PHI scrub**: add the locale's national-ID pattern with guards.
4. **Critic / suggester prompts**: add paraphrase pairs + denial patterns + boilerplate traps + ICD specifics (a few hours of clinician review).
5. **`isAbsenceDescription`**: add 3-5 locale-specific absence phrasings.
6. **Label sets**: extend `STRUCTURAL_VITAL_LABELS`, `EXAM_NARRATIVE_LABELS`, `ZAVER_LABELS`.
7. **Templates**: clone existing templates; translate `section.context`, `template.systemPrompt`, `section.labels`; curate new `template.styleExamples` from locale corpus.
8. **Evals**: add 1-2 doctor-corrected fixtures in the new locale to `web/src/lib/evals/fixtures/` and register in `scripts/run-evals.ts`.

### Checklist — adding a new specialty (e.g. neurology)

1. **ICD suggester prompt**: add specialty-specific code traps (e.g. G35 MS, G20 Parkinson, F32 depression), primary-code rules, and anatomy cross-checks to [`suggest-icd.ts`](../web/src/lib/sections/suggest-icd.ts).
2. **Critic prompt**: add specialty's common boilerplate traps (e.g. "reflexy sym. prítomné", "MMSE v norme") to the boilerplate list in [`critic.ts`](../web/src/lib/sections/critic.ts).
3. **Templates**: create specialty templates with section hierarchy, `section.context` contracts tuned to the specialty, `template.systemPrompt` with specialty worldview, `template.styleExamples` from specialty corpus.
4. **Evals**: add fixtures exercising specialty-specific risks (e.g. for neurology: stroke type discrimination, MS vs ALS, migraine subtype).
5. **No code-level specialty flag** — all specialty logic lives in templates + prompt examples. The pipeline is specialty-neutral.

### Scoping the work

| Task | Locale lift | Specialty lift |
|---|---|---|
| Code changes | ~8 files, ~200 lines | ~2 files, ~50 lines |
| Clinician content | ~1-2 days prompt review + translation | ~1 day for ICD traps + boilerplate |
| Template authoring | 1 template cloned + translated per specialty | 3-5 new templates per specialty |
| Voice corpus curation | 10-20 attending notes per template | Same, per template |
| Eval fixtures | 2-3 per locale | 2-3 per specialty |

The heaviest work is clinician review of prompt examples + template curation, not engineering. The code-side work is a half-day of plumbing.

---

## 0. Pipeline Overview

Per section, three Haiku-era stages: RENDER → CRITIC (opt-in) → RECONCILERS. Záver is produced by the ICD suggester (source-grounded Haiku call) and then pushed through the same CRITIC + RECONCILERS.

```
              INPUTS
               |
  transcript + files[{text, context?}] + doctorNotes
               |
  Stage 1      scrubPhi                              pure TS (regex)
               -> patient name (when known), rodné číslo, phone, email,
                  PSČ+city, slash-notation addresses
               |
  Stage 2      parallel (started immediately):
               |  suggestIcdCodes(source)                     sections/suggest-icd.ts
               |    -> Haiku, 10–15 CSV-validated ICD candidates
               |    -> ranked by relevance, primary first
               |    -> optional `differential` on symptom-code primary
               |
               |  generateNote(template, source)              sections/pipeline.ts
               |    -> walks template leaves in order, SKIPS Záver
               |    -> per leaf:
               |        renderSection (Haiku)                 sections/section-agent.ts
               |          * system prompt: role + worldview + corpus examples + contract
               |          * user message: source (transcript, doctorNotes, files)
               |          * emits raw draft via onSection (UI streams)
               |
               |        if section.critic === true (opt-in):
               |          criticPass (Haiku, background)      sections/critic.ts
               |            * source + draft + section.context
               |            * removes invention / adds missed facts
               |            * isAbsenceDescription strips meta-commentary
               |          reconcilers[] (drug-normalizer / icd-validator)
               |          emits corrected content via onSection (UI replaces)
               |
               |        if no critic:
               |          reconcilers[] run immediately after render
               |          single emit with final content
               |
  Stage 3      Záver injection                      route (generate / regenerate)
               -> formatZaverFromSuggestions(codes) → draft
               -> runCriticAndReconcilers(draft, source, zaver.context)
                    * critic pass when zaver.critic === true
                    * icd-validator reconciler canonicalises + drops CM codes
                      + dedupes redundant parentheticals (MGUS)
               -> written to sectionContentsMap[zaverId]
               -> synthetic SSE section event fires
               |
  Stage 4      buildTemplateHtml                    templates/html.ts
               -> concat sections in template hierarchy -> final HTML
               -> skipEmpty drops blank subsections
```

Clinical knowledge lives in three places:

1. **`template.styleExamples`** (jsonb) — real attending reference notes. The corpus. [`lib/templates/reference-notes.ts`](../web/src/lib/templates/reference-notes.ts) parses them per-section at generation time and injects up to 3 per-section snippets as few-shot voice examples. Style, tone, phrasing emerge from the corpus, not from prompt rules.
2. **`template.systemPrompt`** — template-wide guardrails (specialty worldview, abbreviation conventions). Injected once per section-agent call.
3. **`section.context`** — per-section contract (OWNS / NEVER OWNS / NO INVENTION / WHEN EMPTY). Short; format/voice prescriptions live in the corpus instead. Also feeds the critic pass verbatim.

Per-section flags on the template:

- `section.model: "haiku" | "sonnet" | "opus"` — which tier renders the draft (defaults to Haiku)
- `section.critic: boolean` — enables the critic pass (defaults to false). Enabled on HPI/TO, OA, Záver via [`scripts/enable-critic-on-narrative-sections.mjs`](../web/scripts/enable-critic-on-narrative-sections.mjs)
- `section.reconcilers: string[]` — ordered names of post-critic reconcilers (see `sections/reconcilers/`)

---

## 1. Key Files

### Pipeline

| File                                                                                              | Role                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`web/src/lib/sections/pipeline.ts`](../web/src/lib/sections/pipeline.ts)                         | Orchestrator. Walks template leaves in order, skips Záver (fed by suggester), per leaf: render → (critic, if enabled, in background) → reconcilers → emit. `findZaverSection` + `runCriticAndReconcilers` exported for the route's Záver path.         |
| [`web/src/lib/sections/section-agent.ts`](../web/src/lib/sections/section-agent.ts)               | `renderSection` — one Anthropic call per section. System prompt: role + template worldview + corpus examples + section contract. User message: source with `# File: … (Doctor's focus: …)` when set. `isAbsenceDescription` safety net also lives here. |
| [`web/src/lib/sections/critic.ts`](../web/src/lib/sections/critic.ts)                             | `criticPass` — second Haiku call per opt-in section. Input: source + draft + section.context. Output: corrected draft text. Preserves voice / ordering / connective tissue; removes invention; adds missed facts.                                      |
| [`web/src/lib/sections/suggest-icd.ts`](../web/src/lib/sections/suggest-icd.ts)                   | One-shot Haiku call: source → 10–15 CSV-validated ICD-10 candidates (ranked). Output powers BOTH the right-side "Navrhované kódy" panel AND the Záver section.                                                                                         |
| [`web/src/lib/sections/format-zaver.ts`](../web/src/lib/sections/format-zaver.ts)                 | Deterministic formatter: `SuggestedIcdCode[]` → Záver line ("primary [differential], secondaries, …").                                                                                                                                                 |
| [`web/src/lib/templates/reference-notes.ts`](../web/src/lib/templates/reference-notes.ts)         | Parses `template.styleExamples` (full attending notes) into per-section snippet buckets via label matching. Round-robin selects 3 per section. Feeds `# Voice examples` block.                                                                         |
| [`web/src/lib/sections/reconcilers/index.ts`](../web/src/lib/sections/reconcilers/index.ts)       | Registry: `drug-normalizer`, `icd-validator`. Each reconciler has signature `(text, source, { language }) => string`.                                                                                                                                  |

### Routes

| File                                                                            | Role                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`web/src/app/api/generate/route.ts`](../web/src/app/api/generate/route.ts)     | POST `/api/generate`. Auth → audio recovery → file extraction → PHI scrub → parallel `suggestIcdCodes` + `generateNote` → Záver via `formatZaver` + `runCriticAndReconcilers` → save + SSE stream.                                                           |
| [`web/src/app/api/regenerate/route.ts`](../web/src/app/api/regenerate/route.ts) | POST `/api/regenerate`. Same flow as generate, starting from cached raw source. No audio recovery, no inline file extraction.                                                                                                                                |

### Utilities

| File                                                                        | Role                                                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [`web/src/lib/phi-scrubber.ts`](../web/src/lib/phi-scrubber.ts)             | Deterministic PHI scrub. Runs once on raw source before any LLM call.                             |
| [`web/src/lib/lookup/icd.ts`](../web/src/lib/lookup/icd.ts)                 | ICD-10 CSV loader — `getIcdDescription` (used by suggester + reconciler), `searchIcd` / `resolveIcdCodes` (admin panel). |
| [`web/src/lib/lookup/medications.ts`](../web/src/lib/lookup/medications.ts) | Medication CSV loader — `isValidMedication`, `correctMedicationBaseName` (drug-normalizer reconciler), `searchMedications` (admin panel). |
| [`web/src/lib/templates/html.ts`](../web/src/lib/templates/html.ts)         | `buildTemplateHtml` concatenates rendered section contents into the final HTML note.              |

---

## 2. The Section Contract (`section.context`)

Stored in `templates.sections[].context` as plain text. Admin-editable per template. Example (LA):

```
LA — aktuálna chronická medikácia pacienta.

Formát:
- Jedna položka na riadok vo formáte: Názov lieku dávka frekvencia.
- Zachovaj slovenskú dávku a frekvenciu presne ako sú v zdroji
  ("1-0-1", "ráno a večer", "podľa potreby", "sc à 24h").
- Každá položka musí mať oporu v overenom fakte typu `medication` …
- Vylúč: lieky, ktoré pacient vysadil / neberie / prestala užívať.
- Ak nie sú žiadne medikácie, vráť prázdny reťazec.
```

The agent sees this as part of its system prompt together with:

- The section title and the target language.
- A universal rule block: ground truth = raw source, verbatim preservation, empty string when nothing fits.
- The template's `systemPrompt` (worldview).
- Up to 3 corpus snippets from `styleExamples` (voice examples).

The critic pass (when enabled) ALSO receives `section.context` verbatim — so the same contract both guides initial drafting and audits the output.

### Cross-section consistency

Enforced two ways:

1. **Section contract** explicitly names what NOT to include ("NEVER list medications — they belong to LA"). Rendered into both the author's system prompt and the critic's system prompt.
2. **Critic pass** checks the draft against the contract and removes any content that belongs in another section (e.g. medications appearing in Postup a plán get dropped).

There is no shared "facts" layer; each section sees the full source independently.

---

## 3. Per-section Model Selection

Every section carries `section.model: "haiku" | "sonnet" | "opus"` (defaults to `haiku`). Most sections (structured lists, vitals, allergies) work great on Haiku and finish in ~1–2s each. Narrative-heavy sections (TO/HPI, Záver, Plan) can be upgraded to Sonnet or Opus per-template if quality demands it.

The critic always runs on Haiku — a cheap, fast audit. Model IDs live in [`section-agent.ts`](../web/src/lib/sections/section-agent.ts) and [`critic.ts`](../web/src/lib/sections/critic.ts) under `MODEL_IDS`.

---

## 4. The critic pass (opt-in)

Set `section.critic = true` on the template to enable a second Haiku pass that audits the draft against the raw source.

What it does:
- **Removes invention**: any fact/number/name/drug/diagnosis/wording in the draft not found in the raw source → deleted.
- **Adds omission**: any fact in the source that belongs in this section (per `section.context`) but is missing from the draft → added, formatted consistently with the existing draft.
- **Preserves voice**: formatting, ordering, connective tissue ("pred dvoma dňami", "včera", "preto"), negations.
- **Returns UNCHANGED** byte-for-byte when the draft is already faithful.

Where to enable:
- Narrative / clinical-judgment sections where invention or omission hurt most: **HPI/TO, OA, Záver**.
- Skip structural sections (Vitals, BMI, EKG, LA, AA, etc.) where a second Haiku pass just adds noise.

The [`enable-critic-on-narrative-sections.mjs`](../web/scripts/enable-critic-on-narrative-sections.mjs) script sets `critic=true` on every LA/TO/Záver-labelled section across all templates (idempotent, dry-run first).

Logging: whenever the critic actually changes content, pipeline.ts logs `[pipeline] critic modified "<title>" — len X→Y`. That's your diff record for spot-checking whether the critic is helping or over-correcting.

---

## 5. Reconcilers

Reconcilers are pure TS post-critic transforms:

```ts
type Reconciler = (
  text: string,
  source: RawSource,
  ctx: { language: Language },
) => string;
```

Registered in [`sections/reconcilers/index.ts`](../web/src/lib/sections/reconcilers/index.ts). Attached to sections via `section.reconcilers: string[]` — set by [`web/scripts/enable-reconcilers.mjs`](../web/scripts/enable-reconcilers.mjs) (idempotent, label-matched).

| Name               | Runs on                 | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drug-normalizer`  | LA / medication sections | Extracts the leading drug-name prefix from each line or comma-separated entry, short-circuits through `ABBREVIATION_ALIASES` (e.g. `ANP → ANOPYRIN`), then fuzzy-corrects against the medication CSV if no alias hit. Preserves dose/frequency verbatim.                                                                                                                                                                                                    |
| `icd-validator`    | Záver                    | Code-boundary splitter (not comma-based). Per code: CSV hit → canonical description; 1-2 decimal digit miss with valid root → downgrade; ICD-10-CM shape (≥3 decimal digits) + no CSV → drop. Also dedupes redundant parentheticals — if the CSV canonical already ends with `(MGUS)` and the input also ends with `(MGUS)`, drops the duplicate.                                                                                                           |

**Absence stripper** is built into `renderSection` (and applied on critic output via `runCriticAndReconcilers`), not a registered reconciler. Catches "V surových zdrojoch…", "(empty)", "ZERO CHARACTERS", cleanup-pass meta-commentary essays, "Žiadne údaje…", "The current output contains no …". See `isAbsenceDescription` in `section-agent.ts`.

---

## 6. Reference-notes corpus + ICD suggester

### Corpus (`template.styleExamples`)

Admins attach real attending notes to a template via the template editor's "Reference Notes Corpus" panel (admin). Upload hits [`admin/app/api/templates/analyze-note/route.ts`](../admin/app/api/templates/analyze-note/route.ts) which extracts text (PDF/image/plain), PHI-scrubs via [`admin/lib/phi-scrubber.ts`](../admin/lib/phi-scrubber.ts), and returns a `proposedExample` plus the analyzer's detected sections. Preview shows per-section capture (done client-side via [`admin/lib/reference-notes-parser.ts`](../admin/lib/reference-notes-parser.ts)) before save.

At generation time, `buildSectionExamplesMap` parses every attached note into per-section snippets using the template's own labels (flat label index, diacritic-stripped, case-insensitive). Each section-agent receives up to 3 snippets as the `# Voice examples` block in its system prompt — explicit instruction: "mimic the TONE and STRUCTURE, never copy patient-specific facts".

The critic pass does NOT see the corpus — it audits against source only.

### ICD suggester

[`suggest-icd.ts`](../web/src/lib/sections/suggest-icd.ts) runs ONCE per generation, in parallel with section rendering. Source-only input (no facts, no sections).

The prompt anchors the model against common specificity traps (mitral vs aortic, paroxysmal vs persistent AF, 1st vs 2nd degree AV block, post-surgical vs drug-induced hypothyroidism, active cataract vs post-IOL status-post) so it picks the code the source actually implies.

Output feeds two places:

1. **Right-side panel** — persisted to `visit.metadata.clinical_analysis.suggestedIcdCodes`. [`IcdPanelContent`](../web/src/components/encounters/icd-panel.tsx) reads it and renders the ranked list with per-code confidence.
2. **Záver section** — `formatZaverFromSuggestions` joins the codes into a comma-separated line. Primary first; if the primary is a symptom code (R07.4, R06.0, etc.) the suggester provides a `differential` field which gets rendered as `(diferenciálna dg.: …)`. The formatted draft is then passed through the critic (if enabled on Záver) and the `icd-validator` reconciler before injection into `sectionContentsMap[zaverId]`.

Every code is CSV-validated inside the suggester. CM-shaped codes (≥3 decimal digits) not in the Slovak CSV are dropped. Codes with unknown roots are dropped. "Low" confidence codes are excluded from Záver but still surface in the right-panel.

---

## 7. Streaming

The route creates an SSE stream. The pipeline emits `onSection` events:

- **First emit per section**: raw draft (or final content if no critic).
- **Second emit per section (optional)**: corrected critic output + reconcilers, when the critic actually changed something. UI replaces by id.

Sections stream in template order (depth-first). Typical full generation: ~40s on an average encounter with 3 critic'd sections (HPI/TO, OA, Záver).

---

## 8. Regenerate Path

Regenerate is nearly identical to generate. Differences:

- No audio recovery, no inline file extraction — the visit already has `metadata.transcript`, `metadata.doctor_notes`, and `metadata.files[].extracted_text` cached.
- Reads raw source from metadata, runs the same pipeline.
- All former branches (fact-based rerender, prose reformat, full Opus) collapsed into a single "run with possibly-new template" flow.

---

## 9. What's Intentionally NOT in the Pipeline Anymore

| Removed                                                                 | What it did                                                    | Why it's gone                                                                                                      |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Sonnet clinical-analysis Pass 1                                         | Inferred specialty, matched concepts, suggested ICD candidates | Non-deterministic; replaced by deterministic section contracts + reconcilers.                                      |
| Haiku fact-extraction Pass 1.5                                          | 15-category structured facts with source evidence              | Sections now read raw source directly, nothing is pre-filtered out.                                                |
| Fact validator / resolver / timeline                                    | Drop ungrounded / self-corrected / time-conflicting facts      | No facts → no fact pipeline.                                                                                       |
| Diagnosis resolver + synonym table                                      | Deterministic ICD resolution from diagnosis facts              | Záver section now emits ICD codes directly from raw source.                                                        |
| ICD certainty filter                                                    | Drop ICD candidates not lexically grounded in facts            | Reconciler-level concern, not a pipeline stage.                                                                    |
| EncounterModel                                                          | Single source of truth for bucketed facts / problems           | Replaced by: source + critic pass = all an agent needs.                                                            |
| Deterministic section renderers (medications, vitals, assessment, etc.) | Format structured slots without LLM                            | Each section is now an LLM call. If determinism is critical for a given section, add a reconciler.                 |
| Specialty pack                                                          | Per-language, per-specialty prompt variants                    | Templates themselves are per-specialty; pack lives in the template's system prompt + each section's context.       |
| `generateFromTemplate` / `anthropic.ts`                                 | 1,200-line monolithic two-pass generation                      | Replaced by ~300 lines across `pipeline.ts` + `section-agent.ts` + `critic.ts`.                                    |
| Source preprocessor (`source-preprocessor.ts`)                          | Regex pass over source emitting `<STRUCTURED_FACTS>` XML tags  | The critic pass handles the same "make sure nothing was missed" job with broader coverage and no regex maintenance. |
| Sonnet fact extraction (Phase 1 experiment)                             | Tool-use extraction of verified `ClinicalFact[]` with quotes   | Was architecturally interesting but added 30–60s of latency and complexity. The critic pass delivers the same quality guarantee faster using only source + draft. |
| Per-section `factTypes` opt-in (Phase 2b experiment)                    | Section renders from filtered facts instead of raw source      | Rolled back together with fact extraction — the critic pass covers the same failure modes.                         |

See the commit history if you need to understand why a specific piece was removed.

---

## 10. Adding a New Section

1. In the template editor (admin UI), add a section: id, label(s), `context`.
2. Pick a model (defaults to Haiku; override only if clearly needed).
3. (Optional) set `critic: true` if the section is narrative or makes clinical judgments.
4. (Optional) add reconcilers by string key.
5. Save. The next generation uses it. No code change, no deploy.

---

## 11. Debugging

- **Section rendered empty** — check the `context`: did the "output ZERO characters" rule fire? If a critic-enabled section is empty, the critic also checks — look for `[pipeline] critic modified "<title>"` in the logs.
- **Section content leaking between sections** — tighten the `NEVER OWNS` list in both sections' contexts. The critic pass will enforce the rule on subsequent runs.
- **Wrong dose/drug name in LA** — the `drug-normalizer` alias map in [`reconcilers/drug-normalizer.ts`](../web/src/lib/sections/reconcilers/drug-normalizer.ts) catches known Slovak shortforms (ANP, ASA, NTG). Add to `ABBREVIATION_ALIASES` when a new one surfaces.
- **Hallucinated / wrong ICD in Záver** — the suggester is the root cause; the critic + `icd-validator` are the safety net. Tighten the suggester's prompt in [`suggest-icd.ts`](../web/src/lib/sections/suggest-icd.ts) — especially the "anatomy / severity / subtype / etiology" trap list — or confirm the ICD CSV has the right subcode. If a duplicate parenthetical like `(MGUS) (MGUS)` appears, the `parenIsRedundant` guard in `icd-validator` is the right place to extend.
- **Cascade-shift in rendered note** — section content appears under the wrong heading: the culprit is [`parseNoteToSectionMap`](../web/src/lib/parse-note-sections.ts). It must match by label, not by index. Tested in `parse-note-sections.test.ts`.
- **Agent output doesn't sound like an attending** — the template needs a corpus. Upload 2–5 real notes via the admin template editor's Reference Notes Corpus panel.
- **Meta-commentary leaks ("ZERO CHARACTERS", essay about why the section is empty)** — `isAbsenceDescription` should catch it. If a new variant leaks, add a pattern there and a test case in `absence-description.test.ts`.
- **Slow generation** — check `section.model` on expensive sections. Currently a full generation with 3 critic'd sections takes ~40s on a 12k-char encounter.
