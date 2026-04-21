/**
 * One-shot: REPLACE a matching section's `context` with a purpose-built
 * "isolated container" template. These templates treat each section as a
 * hard-walled container with explicit OWNS / NEVER OWNS / POSITIVE EXAMPLES /
 * NEGATIVE EXAMPLES / FORMAT / WHEN EMPTY blocks.
 *
 * Unlike `patch-section-contexts.mjs` (which APPENDS rule blocks), this
 * script REPLACES the whole context. Backs up the previous context into
 * `section.previousContext` so we can roll back.
 *
 * Usage:  node scripts/perfect-section-contexts.mjs [--dry-run] [--rollback]
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envRaw = readFileSync(join(__dirname, "..", ".env.local"), "utf-8");
const env = Object.fromEntries(
  envRaw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      let v = l.substring(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      return [l.substring(0, i).trim(), v];
    }),
);

const DRY_RUN = process.argv.includes("--dry-run");
const ROLLBACK = process.argv.includes("--rollback");

function normalizeLabel(l) {
  return l
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[:\s]+$/g, "");
}

// ── CANONICAL CONTEXT TEMPLATES ────────────────────────────────────────
// Each entry: a set of section labels + the full replacement context.

const CANONICAL = [
  // ── RA ──────────────────────────────────────────────────────────────
  {
    id: "ra",
    labels: new Set(["ra", "rodinna anamneza", "family history", "fhx"]),
    context: `RA — Family history (relatives only).

## OWNS — include ALL of these and ONLY these
- Diseases / conditions of parents (father, mother).
- Diseases / conditions of siblings (brothers, sisters).
- Diseases / conditions of grandparents.
- Diseases / conditions of children, if mentioned.
- Causes of death for any of the above.
- Ages at death or age-at-diagnosis when stated.

## NEVER OWNS — if you see these in source, route elsewhere
- Patient's own diseases / chronic conditions → OA.
- Patient's own surgeries / procedures → OA.
- Patient's spouse's diseases / caregiving context → SA.
- Patient's own habits (smoking, alcohol) → Ab.
- Patient's allergies → AA.
- Family / spouse / children as LIVING ARRANGEMENT (not health) → SA.

## POSITIVE EXAMPLES
- "Otec zomrel v 68 rokoch na infarkt" → "Otec zomrel v 68 rokoch na infarkt."
- "Matka mala cukrovku, žila do 84" → "Matka mala cukrovku, žila do 84 rokov."
- "Brat popíjal alkohol" → "Brat mal problém s alkoholom."

## NEGATIVE EXAMPLES (do NOT include)
- "Manžel má Alzheimerovu chorobu" → belongs to SA (caregiver context), not RA.
- "Pacient má hypertenziu" → belongs to OA.
- "Žije s manželkou" → belongs to SA.

## FORMAT
- One or two short sentences per relative, Slovak clinical prose.
- Preserve verbatim: cause of death, age, time markers, condition names.
- End with a period.
- Multiple conditions for one relative → comma-separated: "Matka mala cukrovku, hypertenziu."

## WHEN EMPTY
If the source never mentions parents, siblings, grandparents, or children, output ZERO characters.`,
  },

  // ── OA ──────────────────────────────────────────────────────────────
  {
    id: "oa",
    labels: new Set([
      "oa",
      "osobna anamneza",
      "osobni anamneza",
      "past medical history",
      "pmhx",
    ]),
    context: `OA — Patient's personal medical history: chronic conditions, past surgeries, past procedures, long-standing comorbidities coming INTO this encounter.

## OWNS — include ALL of these
- Chronic diseases (hypertension, diabetes, arrhythmias, COPD, etc.).
- Past surgeries ("stav po strumektómii", "stav po cholecystektómii").
- Past procedures, ablations, stentings, kyretáže.
- Long-standing comorbidities with staging / severity ("hypertenzia III. stupňa", "stredne závažná mitrálna regurgitácia").
- Past injuries with lasting effects.
- Chronic pain conditions.
- Known tumours, MGUS, monoclonal gammopathy.
- Chronic neurological or psychiatric conditions.

## NEVER OWNS
- Current encounter's acute complaint / symptoms → TO.
- Current medications → LA.
- Family's diseases → RA.
- Allergies → AA.
- Substance use → Ab.
- Marital / living / occupational status → SA / PA.
- Vital signs / exam findings → Objektívne vyšetrenie.
- Current diagnosis / differential for THIS encounter → Záver.

## POSITIVE EXAMPLES
- Source mentions "stav po strumektómii", "fibrilácia predsiení", "hypertenzia III. stupňa" → include ALL three.
- Source mentions "pálenie žalúdka" (as a chronic complaint, not current acute) → include.
- "Kŕčové žily" mentioned anywhere as a chronic thing → include.

## NEGATIVE EXAMPLES
- "Dnes má bolesť na hrudi od 13:00" → goes to TO.
- "Berie Eliquis 5 mg" → goes to LA.
- "Otec zomrel na infarkt" → goes to RA.

## FORMAT
- Comma-separated list in Slovak prose.
- Preserve clinical abbreviations VERBATIM (st.p., MGUS, ICHS, AV blok, SR, VDF, DK, HKK, Mi regurg.).
- Preserve disease staging / severity qualifiers exactly (III. stupňa, kompenzovaná, paroxyzmálna, stredne závažná).
- End with a period.
- Do NOT assign ICD codes here — Záver owns those.

## WHEN EMPTY
If the source has no past diseases, surgeries, or comorbidities, output ZERO characters.`,
  },

  // ── SA ──────────────────────────────────────────────────────────────
  {
    id: "sa",
    labels: new Set([
      "sa",
      "socialna anamneza",
      "socialni anamneza",
      "social history",
    ]),
    context: `SA — Patient's social situation (home life, relationships, social support).

## OWNS — include ALL of these
- Marital status (married, single, divorced, widowed).
- Who the patient lives with (spouse, children, alone).
- Dependents the patient cares for (e.g. spouse with dementia, children).
- Social support network (family nearby, community support).
- Living situation (house, apartment, care home) when mentioned.

## NEVER OWNS
- Occupation / job title / workplace / years of employment → PA.
- Retirement / working status → PA (but "na dôchodku" as a standalone living-situation descriptor may appear here too if relevant).
- Smoking, alcohol, drugs → Ab.
- Family diseases → RA.
- Patient's own diseases → OA.
- Allergies → AA.
- Current symptoms → TO.

## POSITIVE EXAMPLES
- "Žije s manželom" → "Žije s manželom."
- "Manžel má začínajúcu Alzheimerovu chorobu, stará sa oňho" → "Žije s manželom, o ktorého sa stará. Manžel má začínajúcu Alzheimerovu chorobu."
- "Žije sama, deti v zahraničí" → "Žije sama, deti žijú v zahraničí."

## NEGATIVE EXAMPLES
- "Pracovala ako účtovníčka" → belongs to PA.
- "Otec zomrel na infarkt" → belongs to RA.
- "Nefajčí" → belongs to Ab.

## FORMAT
- Short Slovak sentences.
- Preserve wording the patient uses.
- End with a period.

## WHEN EMPTY
If the source never mentions marital / living / care-arrangement info, output ZERO characters.`,
  },

  // ── PA ──────────────────────────────────────────────────────────────
  {
    id: "pa",
    labels: new Set([
      "pa",
      "pracovna anamneza",
      "pracovni anamneza",
      "occupational history",
      "work history",
    ]),
    context: `PA — Patient's occupational history.

## OWNS — include ALL of these
- Current or past occupation / job title.
- Workplace / employer.
- Years spent in the role.
- Type of work (sedavé, fyzicky náročné, vonkajšie prostredie, nočné smeny).
- Work-related exposures (chemicals, dust, loud noise) — when occupationally relevant.
- Retirement status (na dôchodku / pracuje).

## NEVER OWNS
- Marital status / living arrangement → SA.
- Family diseases → RA.
- Substance use → Ab.
- Patient's own diseases / pain → OA (even if work-related).

## POSITIVE EXAMPLES
- "Pracovala v účtovníctve v obchodnom dome Prior 30 rokov, sedavé zamestnanie" → "Účtovníctvo v obchodnom dome Prior 30 rokov, sedavé zamestnanie."
- "Pracuje v bezpečnostnej službe" → "Pracuje v bezpečnostnej službe."
- "Na dôchodku" (when this is the only employment info) → "Na dôchodku."

## NEGATIVE EXAMPLES
- "Žije s manželkou" → belongs to SA.
- "Kvôli práci má bolesti chrbta" → the chronic back pain belongs to OA; work context can be mentioned in PA if specifically occupational.

## FORMAT
- Short, verbatim. Prefer noun phrases over full sentences.
- Preserve employer names, durations, role types.
- End with a period.

## WHEN EMPTY
If the source never mentions occupation or working status, output ZERO characters.`,
  },

  // ── EA ──────────────────────────────────────────────────────────────
  {
    id: "ea",
    labels: new Set([
      "ea",
      "epidemiologicka anamneza",
      "epidemiologicka anamneza",
      "epidemiological history",
      "epi history",
    ]),
    context: `EA — Epidemiological history. VERY narrow scope.

## OWNS — include ONLY these four categories
1. Recent travel (foreign trips, endemic-area exposure).
2. Tick / insect bites or exposures.
3. Infectious contacts (sick contacts, TB exposure, COVID exposure).
4. Vaccinations (flu, COVID, tetanus, travel vaccines).

## NEVER OWNS — explicit redirects
- Coughing / chronic cough / seasonal cough → TO (if current) or OA (if chronic). NEVER EA.
- Pollen allergy, dust mites, dust → AA. Allergens are NOT infectious exposures.
- Marital / cohabitation / caregiving → SA.
- Smoking / alcohol / drugs → Ab.
- Family diseases → RA.
- Patient's own diseases / past surgeries / injuries → OA.
- Presenting symptoms of this encounter → TO.
- Occupation / job → PA.

## POSITIVE EXAMPLES
- "V marci bola v Egypte 2 týždne" → "V marci pobyt v Egypte 2 týždne."
- "Mal kliešťa minulý týždeň" → "Minulý týždeň kliešťové poranenie."
- "Očkovanie proti chrípke pred mesiacom" → "Očkovanie proti chrípke pred mesiacom."
- "Syn mal COVID pred dvomi týždňami" → "Kontakt s COVID-19 (syn) pred dvomi týždňami."

## NEGATIVE EXAMPLES — do NOT include
- "Pokašlávam hlavne v zime a na jar kvôli peľu" → cough → TO/OA; pollen → AA. EA should be EMPTY on this input.
- "Žije s manželom, má Alzheimerovu chorobu" → belongs to SA.
- "Alergia na mukolytiká" → belongs to AA.
- "Roztoče, peľ" → belongs to AA.

## FORMAT
- Short, factual Slovak sentences.
- Preserve exact wording of the exposure (time, place, agent).
- End with a period.

## WHEN EMPTY (most common case)
If the source does not explicitly mention foreign travel, tick/insect exposure, infectious contacts, or vaccinations, output ZERO characters.`,
  },

  // ── AA ──────────────────────────────────────────────────────────────
  {
    id: "aa",
    labels: new Set([
      "aa",
      "alergicka anamneza",
      "alergie",
      "allergies",
      "allergy history",
    ]),
    context: `AA — Allergies and intolerances.

## OWNS — include ALL of these
- Drug allergies (medications the patient cannot take).
- Food allergies.
- Contrast / contrast-agent allergies.
- Environmental allergies (pollen, dust, dust mites, pet dander, mould).
- Anaphylactic reactions and their triggers.
- Specific reactions the patient described (rash, swelling, dyspnoea).

## NEVER OWNS
- Current infections / coughs → TO or OA.
- Substance-use habits (smoking, alcohol, drugs) → Ab.
- Travel / infectious exposures → EA.
- Family history of allergies → RA (rare; usually the patient's own allergies belong here).

## POSITIVE EXAMPLES
- "Alergia na penicilín — vyrážka" → "Penicilín — vyrážka."
- "Peľ, roztoče, mukolytiká — opuch prstov a pier" → "Peľ, roztoče, mukolytiká — opuch prstov a pier."
- "Kontrastné látky nie" (explicit denial) → include as: "Kontrastné látky — neguje." OR omit (depends on doctor's style).

## NEGATIVE EXAMPLES
- "Pacientka pokašľáva v zime" → chronic cough belongs to OA, not an allergy.
- "Fajčiar" → belongs to Ab.

## FORMAT
- Comma-separated list: "Peľ, roztoče, mukolytiká."
- Include reaction details when given: "Penicilín — rash; peľ — sezónna rinitída."
- Preserve exact drug / allergen names the doctor used.
- End with a period.

## WHEN EMPTY
If the source explicitly says the patient has no allergies ("NKDA", "žiadne alergie neguje"), include that short phrase. If the source does not mention allergies at all, output ZERO characters.`,
  },

  // ── LA ──────────────────────────────────────────────────────────────
  {
    id: "la",
    labels: new Set([
      "la",
      "lieky",
      "liek",
      "meds",
      "medication",
      "medications",
      "current medication",
      "current medications",
      "aktualna medikacia",
      "aktualni medikace",
      "liekova anamneza",
    ]),
    context: `LA — Medications. ALL medications the patient is taking, both at home and those given during this encounter.

## OWNS — include ALL of these
- Chronic home medications (the patient's regular regimen).
- Medications administered during this encounter (Heparin, Aspirin, morphine, nitroglycerín, ambulance / ED medications).
- Over-the-counter or as-needed medications the patient uses (Tunol podľa potreby, etc.).
- Dose (number + unit) when the speaker states it.
- Frequency (1-0-1, 1-0-0, ráno a večer, podľa potreby) verbatim.
- Route (per os, i.v., i.m.) when stated.

## NEVER OWNS
- Allergies → AA.
- Past medications the patient STOPPED / is no longer taking → skip (do not list them).
- Patient's diseases → OA.
- Recommendations for new medications to start → Postup a plán.

## POSITIVE EXAMPLES
- "Eliquis 5 mg ráno a večer" → one line: "Eliquis 5 mg ráno a večer"
- "Heparin 8000 UI i.v." (ED-given) → one line: "Heparin 8000 UI i.v."
- "Tunol podľa potreby kvôli žalúdku" → one line: "Tunol podľa potreby"

## NEGATIVE EXAMPLES
- "Alergia na mukolytiká" → belongs to AA.
- "Prestala brať Aspirín minulý rok" → SKIP (discontinued).
- "Odporúčame začať statín" → belongs to Postup a plán.

## FORMAT
- ONE medication per line.
- Preserve brand name EXACTLY as the doctor wrote (do not substitute brand for generic).
- Include dose + frequency when stated: "Eliquis 5 mg, ráno a večer" / "Betaloc ZOK 25 mg, 1-0-0 ráno".
- Preserve Slovak dose-frequency notation verbatim: "1-0-1", "1-0-0", "ráno a večer", "podľa potreby".
- Enrich from the transcript when the OCR list is missing details — if the patient said "Euthyrox 112 mikrogramov" aloud, include the dose even if the referral just says "Euthyrox".
- No bullets, no numbering, no commas between meds — newlines only.

## WHEN EMPTY
If the source mentions no medications at all, output ZERO characters.`,
  },

  // ── Ab ──────────────────────────────────────────────────────────────
  {
    id: "ab",
    labels: new Set(["ab", "abuzy", "habits", "substance use"]),
    context: `Ab — Substance use (tobacco, alcohol, drugs).

## OWNS
- Smoking status + amount + duration.
- Alcohol use frequency + amount.
- Illicit-drug use + type + frequency.
- "Neguje" / "nefajčí" / "alkohol nepije" — explicit denials.

## NEVER OWNS
- Allergies → AA.
- Occupation → PA.
- Diseases → OA.
- Family substance use → RA.

## POSITIVE EXAMPLES
- "Fajčí 15 cigariet denne, 20 rokov" → "Pacient fajčí 15 cigariet denne, 20 rokov."
- "Alkohol len príležitostne" → "Alkohol užíva príležitostne."
- "Nefajčí, alkohol nepije, drogy neguje" → "Pacient nefajčí. Alkohol nepije. Drogy neguje."

## NEGATIVE EXAMPLES
- "Peľová alergia" → belongs to AA.
- "Pracuje v bare, občas pije so zákazníkmi" → occupation to PA, alcohol detail stays here.

## FORMAT
- Full Slovak sentences. Not fragments like "(cigariet denne)" or hanging numerals.
- One fact per sentence when practical: "Pacient fajčí 15 cigariet denne. Alkohol užíva príležitostne. Drogy neguje."
- Preserve exact numbers and durations the speaker used.

## WHEN EMPTY
If the source says nothing about smoking, alcohol, or drugs, output ZERO characters.`,
  },

  // ── TO ──────────────────────────────────────────────────────────────
  {
    id: "to",
    labels: new Set([
      "to",
      "hpi",
      "history of present illness",
      "anamneza sucasneho ochorenia",
      "anamneza soucasneho onemocneni",
      "sucasna choroba",
      "current illness",
    ]),
    context: `TO / HPI — Present illness narrative. What brought the patient in today and the timeline leading up to it.

## OWNS — include ALL of these
- Chief complaint (first-person or third-person — preserve wording).
- Onset date / time / trigger if stated.
- Symptom timeline (day-by-day progression, intermittent vs continuous).
- Character of symptoms (pálenie, tlaková bolesť, vyžarovanie, dušnosť).
- Modifying factors (pohyb, jedlo, poloha, lieky).
- Prior interventions in the days leading up to this encounter (internistka urobila EKG, odoslala na CPO).
- Pertinent negatives the speaker explicitly mentioned ("neguje nauzeu, vracanie, diplopiu…").
- Labs / imaging the doctor cited as part of the workup THIS encounter (NT-proBNP, troponin, RTG findings).

## NEVER OWNS
- Chronic conditions from before this illness → OA.
- Family diseases → RA.
- Current medications regimen → LA (only mention a drug here if it's part of the acute event, e.g. "striek pod jazyk, ktorý pomohol").
- Social / marital / work info → SA / PA.
- Substance use → Ab.
- Physical examination findings → Objektívne vyšetrenie.
- Final diagnosis / ICD codes → Záver.
- Treatment plan / discharge → Postup a plán.

## POSITIVE EXAMPLES
- "Od nedele na pondelok sa prvýkrát zobudila s pálením nad srdcom, opakovalo sa celý deň, v noci zobudila" → include full timeline.
- "V utorok internistka urobila NT-proBNP 801, troponín 22,5 ng/l, EKG ukazuje AV blok 1. stupňa + SVES" → include all these as part of the workup narrative.
- "Neguje dušnosť, palpitácie, nauseu, vracanie, diplopiu, tinitus" → include verbatim.

## NEGATIVE EXAMPLES
- "Má hypertenziu III. stupňa od 2015" → chronic, belongs to OA.
- "Berie Eliquis 5 mg" → belongs to LA.
- "Manžel má Alzheimera" → belongs to SA.

## FORMAT
- Flowing Slovak clinical prose — this is the narrative section.
- Preserve exact time markers (14:02, "od rana", "včera večer", "od nedele na pondelok").
- Preserve exact numeric values (troponín 22,5 ng/l, NT-proBNP 801 ng/l, TK 150/80).
- Preserve the full pertinent-negatives list the speaker gave.
- End with a period.

## WHEN EMPTY
If the source contains no present-illness narrative (unlikely but possible), output ZERO characters.`,
  },

  // ── Záver ───────────────────────────────────────────────────────────
  {
    id: "zaver",
    labels: new Set([
      "zaver",
      "zaver",
      "assessment",
      "conclusion",
      "diagnosis",
      "diagnostic assessment",
    ]),
    context: `Záver — Clinical assessment: diagnosis + ICD-10 code for THIS encounter.

## OWNS — include ALL of these
- Primary (encounter-driving) diagnosis with its ICD-10 code.
- Differential diagnoses the doctor mentioned (diff dg, versus, rule out, nemožno vylúčiť).
- Active chronic conditions that are clinically relevant to this encounter (hypertension, diabetes, AF) — with their ICD codes.
- Any condition the doctor explicitly identified in their conclusion.

## NEVER OWNS
- Past surgeries (unless still an active clinical concern) → OA.
- Family diseases → RA.
- Allergies → AA.
- Narrative of how the diagnosis unfolded → TO.
- Treatment steps → Postup a plán.

## POSITIVE EXAMPLES
- "R07.4 Bolesť v hrudníku, t.č. nemožno vylúčiť IAP, difdg. NSTEMI" → produces:
  R07.4 Bolesť v hrudníku, bližšie neurčená
  Diferenciálna diagnóza: nemožno vylúčiť nestabilnú angínu pectoris, NSTEMI.
- "Akútny infarkt myokardu neurčitej lokalizácie" → "I21.9 Akútny infarkt myokardu, bližšie neurčený"

## NEGATIVE EXAMPLES
- "Stav po strumektómii" → goes to OA (past surgery, not active dx).
- "Pacientka neguje nauseu, vracanie" → goes to TO (pertinent negatives of the complaint).

## FORMAT
- One ICD code per line, prefixed with the code, then the canonical description.
- Format: "I21.4 Akútny subendokardiálny infarkt myokardu" — code + space + description.
- Use dotted format (I21.4, not I214). The icd-validator reconciler will normalize anyway.
- Preserve differential wording verbatim ("diferenciálne diagnosticky", "nemožno vylúčiť", "versus").
- One differential line after the primary dx is acceptable.

## WHEN EMPTY
If the source contains no diagnostic conclusion (very rare), output ZERO characters.`,
  },

  // ── Postup a plán ───────────────────────────────────────────────────
  {
    id: "plan",
    labels: new Set([
      "postup a plan",
      "plan",
      "recommendation",
      "recommendations",
      "plan of care",
      "doporuceni",
      "odporucania",
      "odporucanie",
    ]),
    context: `Postup a plán — Treatment plan, follow-up, procedures to be done, discharge instructions.

## OWNS — include ALL of these
- Procedures ordered for this encounter (koronarografia, echo, CT, MRI).
- Medications to start / adjust / stop as a result of this encounter.
- Referrals to other specialists.
- Follow-up appointments (praktický lekár do 3 dní, kontrola o mesiac).
- Patient instructions (diet, activity, when to return).
- Informed-consent notes ("pacient/ka poučený/á").
- Work incapacity (PN — pracovná neschopnosť).

## NEVER OWNS
- Current symptoms / complaint → TO.
- Diagnosis / ICD codes → Záver.
- Chronic conditions → OA.

## POSITIVE EXAMPLES
- "Echokardiografia pred výkonom, potom koronarografia cez pravú ruku" → include both.
- "Do 3 dní hlásiť u praktického lekára, v prípade ťažkostí kontrola ihneď" → include verbatim.
- "Odporúča sa zanechanie fajčenia" → include.

## NEGATIVE EXAMPLES
- "Má hypertenziu III. stupňa" → belongs to OA.
- "Pálenie na hrudi od 13:00" → belongs to TO.

## FORMAT
- Short Slovak sentences or bullets (doctor preference; prefer sentences for narrative plans).
- Preserve exact time windows (do 3 dní, o mesiac, 4-6 týždňov).
- Preserve exact procedures and routes (cez pravú ruku, lokálna anestézia).
- End with a period.

## WHEN EMPTY
If the source contains no plan content, output ZERO characters.`,
  },

  // ── Výška / Hmotnosť / BMI (strict empty-return sections) ───────────
  {
    id: "vyska",
    labels: new Set(["vyska", "height"]),
    context: `Výška — Patient's height in centimetres.

## OUTPUT FORMAT
Just the value. Example: "175 cm".

## WHEN EMPTY (almost always)
If the source does not explicitly state a height in cm, output ZERO characters. Do NOT write "nie je uvedená", "V surových zdrojoch…", "(empty)", or any parenthetical describing absence.`,
  },
  {
    id: "hmotnost",
    labels: new Set(["hmotnost", "weight"]),
    context: `Hmotnosť — Patient's weight in kilograms.

## OUTPUT FORMAT
Just the value. Example: "78 kg".

## WHEN EMPTY (almost always)
If the source does not explicitly state a weight in kg, output ZERO characters. Do NOT write "nie je uvedená", "V surových zdrojoch…", "(empty)", or any parenthetical describing absence.`,
  },
  {
    id: "bmi",
    labels: new Set(["bmi"]),
    context: `BMI — Body Mass Index.

## WHEN TO PRODUCE A VALUE
ONLY when BOTH height AND weight are explicitly stated in the source. Compute BMI = weight(kg) / height(m)². Format as: "24,8".

## WHEN EMPTY (almost always)
If height OR weight is missing, output ZERO characters. Do NOT explain why it can't be calculated. Do NOT write "nie je možné vypočítať". Silence is the correct output.`,
  },
];

// Build a flat label-index for O(1) lookup.
const LABEL_TO_CTX = new Map();
for (const entry of CANONICAL) {
  for (const lbl of entry.labels) LABEL_TO_CTX.set(lbl, entry);
}

function walk(section, report) {
  const labels = Object.values(section.labels ?? {}).filter(
    (v) => typeof v === "string",
  );
  const match = labels
    .map((l) => LABEL_TO_CTX.get(normalizeLabel(l)))
    .find(Boolean);

  if (match) {
    if (ROLLBACK) {
      if (section.previousContext) {
        report.push({
          id: section.id,
          labels: section.labels,
          action: `rollback (${section.context.length} → ${section.previousContext.length} chars)`,
        });
        section.context = section.previousContext;
        delete section.previousContext;
      }
    } else {
      const currentContext = section.context ?? "";
      if (currentContext !== match.context) {
        report.push({
          id: section.id,
          labels: section.labels,
          action: `replace (was ${currentContext.length} chars, now ${match.context.length})`,
        });
        if (!section.previousContext) section.previousContext = currentContext;
        section.context = match.context;
      }
    }
  }

  for (const sub of section.subsections ?? []) walk(sub, report);
}

const client = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: templates, error } = await client
  .from("templates")
  .select("id, name, sections");
if (error) {
  console.error(error);
  process.exit(1);
}

let totalTemplatesChanged = 0;
let totalSectionsChanged = 0;

for (const template of templates ?? []) {
  const report = [];
  for (const s of template.sections ?? []) walk(s, report);
  if (report.length === 0) continue;

  totalTemplatesChanged++;
  totalSectionsChanged += report.length;
  const name =
    (template.name && (template.name.en || Object.values(template.name)[0])) ??
    template.id;
  console.log(`\n[${template.id}] ${name}`);
  for (const r of report) {
    const label =
      r.labels.sk ?? r.labels.en ?? r.labels[Object.keys(r.labels)[0]];
    console.log(`  ✓ ${label}  (${r.action})`);
  }

  if (!DRY_RUN) {
    const { error: err } = await client
      .from("templates")
      .update({ sections: template.sections })
      .eq("id", template.id);
    if (err) {
      console.error(`  ✗ save failed: ${err.message}`);
      process.exit(1);
    }
  }
}

console.log(
  `\n${DRY_RUN ? "[DRY RUN] would change" : ROLLBACK ? "Rolled back" : "Replaced"} ${totalSectionsChanged} section(s) across ${totalTemplatesChanged} template(s).`,
);
