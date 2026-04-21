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
    context: `LA — Medications. Include EVERY medication mentioned ANYWHERE in the source (transcript, doctor notes, AND every attached file: discharge summaries, referrals, OCR PDFs, prior hospital records).

## CRITICAL: DO NOT DROP MEDICATIONS
The source for this encounter often includes a discharge summary or referral letter from another doctor. Those documents have a "Liečba", "Medikácia", "Medication", "Odporúčania", "Lieky pri prepustení" block with the full current medication list. You MUST include every medication listed in those blocks, NOT just what the patient named aloud in the conversation.

If the OCR / discharge note lists 7 medications with doses and the transcript adds 1 more, your LA must have all 8.

## OWNS — include ALL of these
- Chronic home medications (the patient's regular regimen) — from the discharge letter's medication list, referral letter, or patient-stated during conversation.
- Medications administered during THIS encounter (Heparin, Aspirin, morphine, Arixtra, etc.) — both those given in the ambulance / ED AND those given on the ward.
- Over-the-counter or as-needed medications the patient uses (Tunol, nitroglycerín striek, etc.).
- Dose (number + unit) when stated anywhere in the source.
- Frequency / Slovak dosing notation verbatim (1-0-1, 1-0-0, 1/2-0-1/2, ráno a večer, podľa potreby).
- Route (per os, sc, iv, im, inhalačne) when stated.

## NEVER OWNS
- Allergies → AA.
- Medications the patient EXPLICITLY stopped ("prestala brať", "vysadené") — skip those.
- Patient's diseases → OA.
- Plan-level medication recommendations ("odporúčame začať statín") → Postup a plán.

## POSITIVE EXAMPLES
- OCR has "PRESTARIUM A 5 mg 1/2-0-1/2" → line: "PRESTARIUM A 5 mg, 1/2-0-1/2"
- OCR has "Arixtra 2,5 mg sc a 24h (15:00)" → line: "Arixtra 2,5 mg sc à 24h (15:00)"
- Transcript adds "Suplasin raz za pol roka" → line: "Suplasin, raz za pol roka (i.a.)"

## FORMAT
- ONE medication per line.
- Preserve brand name EXACTLY as written (no generic substitution).
- Include dose + frequency + route when stated.
- Preserve Slovak dosing notation verbatim ("1-0-1", "1/2-0-1/2", "ráno a večer", "podľa potreby", "sc à 24h").
- No bullets, no numbering, no commas between meds — newlines only.

## WHEN EMPTY
If the source truly mentions no medications anywhere, output ZERO characters. This is rare — discharge letters almost always include a medication list.`,
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
    context: `Záver — Clinical assessment with ICD-10 codes. Concise, professional, extracted ONLY from what the doctor explicitly stated.

## DIAGNOSIS RULES (STRICT)

Include ONLY diagnoses that are:
- explicitly written in the doctor's notes, transcript, or OCR as a diagnosis
- clearly stated as a diagnosis (not a finding, not a suspicion — unless explicitly marked as "nemožno vylúčiť", "versus", "diferenciálne diagnosticky")

Do NOT include:
- raw findings (e.g. EF value, MR grade, lab result number)
- interpretations
- derived diagnoses inferred from findings
- differential diagnoses unless the doctor EXPLICITLY labeled them as such

## LIMITS — DO NOT OVERFLOW
- 1 primary diagnosis (encounter-driving).
- 3-6 secondary diagnoses (active chronic comorbidities relevant to this encounter).

If the OA contains more than 6 conditions, select only the CLINICALLY RELEVANT ones for this encounter's context (e.g. for a cardiology visit: cardiac conditions, hypertension, diabetes, coagulation-related, and other directly-impacting comorbidities come first; purely historical surgeries, dermatologic issues, or unrelated items can be omitted).

## CRITICAL: NO FABRICATION / NO INFERENCE
- Never assign an ICD code for a condition that does NOT appear anywhere in the source.
- Never derive a diagnosis from a finding ("EF 45 %" → do NOT invent "systolic HF").
- Never expand an abbreviation into a new diagnosis.
- Observed real fabrications to avoid: K80.0 Cholelitiáza, D64.9 Anémia, R01.1 Srdečný šelest, Z95.8 Prítomnosť iného implantátu.
- If unsure → OMIT.

## NEVER OWNS
- Narrative of how the diagnosis unfolded → TO.
- Treatment steps, procedures, follow-ups → Postup a plán.
- Family diseases → RA.
- Allergies → AA.

## FORMAT
- ALL diagnoses on ONE LINE, comma-separated. No newlines between codes.
- Each diagnosis written as: "CODE Description" (example: "I21.4 Akútny subendokardiálny infarkt myokardu").
- Dotted code format (I21.4, not I214) — icd-validator will normalize anyway.
- Order on the line: (1) primary diagnosis first, (2) differential clause immediately after the primary in parentheses, (3) 3-6 secondary diagnoses after, most clinically relevant first.
- Differential clause format: "(diferenciálna dg.: <speaker's wording verbatim>)" — keep the doctor's exact phrasing.
- If there is no differential, skip the parenthetical entirely.
- End the full line with a period.

## POSITIVE EXAMPLE (cardiology admission with differential + 5 secondaries)
Source has: "R074 Bolesť v hrudníku, difdg NSTEMI, IAP. OA: hypertenzia III., paroxyzmálna fibrilácia predsiení, stav po strumektómii, MGUS, sleep apnoe, kŕčové žily, pálenie žalúdka, myóm maternice, mikroskopická hematúria, vertigo"

Output (one line, SELECTED to 1 primary + 5 most relevant secondary):
R07.4 Bolesť v hrudníku, bližšie neurčená (diferenciálna dg.: t.č. nemožno vylúčiť nestabilnú angínu pectoris, diferenciálne diagnosticky NSTEMI), I10 Primárna [esenciálna] artériová hypertenzia, I48.0 Paroxyzmálna fibrilácia predsiení, E03.9 Hypotyreóza, bližšie neurčená, D47.2 Monoklonálna gamapatia nejasného významu, G47.3 Syndróm spánkového apnoe.

Note: the OA had 10+ items but only the 5 most clinically relevant to this cardiology encounter made it to Záver. Uterine myoma, varicose veins, microscopic haematuria, vertigo were omitted — they're documented in OA, they don't need to repeat here.

## NEGATIVE EXAMPLES — do NOT produce these
- K80.0 Cholelitiáza when no gallstones mentioned.
- D64.9 Anémia when source has no anaemia diagnosis or lab.
- R01.1 Srdcový šelest when auscultation was clean ("bez šelestov").
- Z95.8 Prítomnosť iného implantátu unless an implant was actually stated.
- Stav po operácii katarakty as a standalone line with no ICD code — assign H25.9 or Z96.1 based on context.

## WHEN EMPTY
If the source contains NO diagnostic content at all (extremely rare), output ZERO characters. Do NOT invent one to fill the space.`,
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

## OWNS (only)
- A specific height value stated in the source in cm.

## NEVER OWNS (explicit redirect)
- Physical examination findings (consciousness, GCS, habitus, skin, posture, orientation) → Celkové vyšetrenie. Even when the source has exam content and no height, DO NOT steal exam content into this section.
- Weight → Hmotnosť.
- Vital signs (BP, HR, SpO2, temperature) → Krvný tlak / Pulz.

## CRITICAL: NO INVENTION
NEVER invent, estimate, or fabricate a height. NEVER pick a "plausible" default like 170 / 175 / 180 cm when the source is silent.

## WHEN A HEIGHT IS STATED ANYWHERE
Output exactly the number + "cm". Look at ALL source files — transcript, doctor notes, AND every attached OCR (discharge summary, referral letter, echo report, cardiology note). Referral letters often have a line like "Výška: 164 cm" or "Výška: 164 cm BMI: 27,9" — if you see it, include the value. Do NOT limit yourself to what the patient said aloud in the conversation.

## WHEN THE SOURCE IS SILENT ON HEIGHT (only if no value anywhere)
Output ZERO characters. Do NOT write "nie je uvedená", "V surových zdrojoch…", "(empty)", or any prose describing absence. Do NOT redirect content from other sections here.`,
  },
  {
    id: "hmotnost",
    labels: new Set(["hmotnost", "weight"]),
    context: `Hmotnosť — Patient's weight in kilograms.

## OWNS (only)
- A specific weight value stated in the source in kg.

## NEVER OWNS (explicit redirect)
- EKG findings (rhythm, rate, ST, T, PQ, QRS, AV blok) → EKG. Even when the source has EKG content and no weight, DO NOT steal it into this section.
- Physical examination → Celkové vyšetrenie.
- Height → Výška.
- Vital signs → Krvný tlak / Pulz.

## CRITICAL: NO INVENTION
NEVER invent, estimate, or fabricate a weight. NEVER pick a "plausible" default like 70 / 75 / 80 kg when the source is silent. A fabricated weight impacts dose calculations and BMI.

## WHEN A WEIGHT IS STATED ANYWHERE
Output exactly the number + "kg". Look at ALL source files — transcript, doctor notes, AND every attached OCR (discharge summary, referral letter, echo report). Referral letters often have a line like "Hmotnosť: 75 kg" or "Hmotnosť: 75 kg Výška: 164 cm" — if you see it, include the value. Do NOT limit yourself to what the patient said aloud.

## WHEN THE SOURCE IS SILENT (only if no value anywhere)
Output ZERO characters. Do NOT write prose describing absence. Do NOT redirect content from other sections here.`,
  },
  {
    id: "bmi",
    labels: new Set(["bmi"]),
    context: `BMI — Body Mass Index.

## OWNS (only)
- A computed BMI value, ONLY when BOTH height AND weight were EXPLICITLY stated in the source.

## NEVER OWNS
- Any other content — do NOT redirect exam findings, EKG, vitals, or anamnestic content here.

## CRITICAL: NO INVENTION / NO INFERENCE
NEVER output a BMI unless BOTH height AND weight are explicitly stated. Do NOT compute from estimated values. Do NOT "use a typical adult BMI".

## WHEN BMI IS EXPLICITLY STATED IN THE SOURCE
If the source already states a BMI (e.g. OCR referral letter says "BMI: 27,9"), output that value verbatim.

## WHEN BOTH HEIGHT AND WEIGHT ARE STATED (and BMI isn't)
Compute BMI = weight(kg) / height(m)². Output as a number with Slovak decimal comma, one digit after the comma. Nothing else.

## WHEN EITHER VALUE IS MISSING (only if nothing in any source)
Output ZERO characters. Do NOT explain why it can't be calculated. Do NOT write "nie je možné vypočítať", "chýbajú údaje".`,
  },

  // ── Objective vitals + exam + EKG (strict, replaces short hint contexts)
  {
    id: "krvny-tlak",
    labels: new Set(["krvny tlak", "krevni tlak", "tlak", "blood pressure", "bp"]),
    context: `Krvný tlak — Blood pressure measurement values from this encounter.

## OWNS (only)
- Systolic/diastolic value in mmHg, as stated in the source.
- Limb (ĽHK / PHK) when stated.
- Position (sediac / ležiac / v stoji) when stated.
- Multiple time-point measurements when the source provides them — keep all, with timestamps.
- Heart rate (HR) when stated in the same vital-signs block.
- SpO2, TT (temperature), respiratory rate when stated in the same block.

## NEVER OWNS
- Hypertension as a diagnosis → OA (chronic) or Záver (billable dx).
- Antihypertensive medication → LA.
- Chronic BP trend / "liečená hypertenzia" as history → OA.
- Physical exam findings → Celkové vyšetrenie.

## CRITICAL: NO INVENTION
Output ONLY explicit numeric values from the source. If the source says "zvýšený tlak" without a number, output only "zvýšený tlak" verbatim — do NOT fabricate a specific value. If the source says nothing about BP, output ZERO characters.

## FORMAT
- One compact line with comma-separated values.
- Preserve the speaker's notation: "TK ĽHK 165/75 mmHg, PHK 155/77 mmHg, HR 51/min reg, SatO2 97 %, TT 36,8 °C."
- Multi-timepoint series on one line: "TK 150/80 mmHg (14:02), 145/80 mmHg (14:31), 143/80 mmHg (15:12)."
- No prose framing, no "TK pacientky je…".

## WHEN EMPTY
If the source contains no BP / vitals measurement, output ZERO characters.`,
  },
  {
    id: "pulz",
    labels: new Set(["pulz", "tep", "srdcova frekvencia", "heart rate", "pulse"]),
    context: `Pulz — Heart rate from this encounter.

## OWNS (only)
- Rate per minute.
- Rhythm (pravidelný / nepravidelný).
- Volume (plný / slabý).
- Central/peripheral distinction when the source provides it.

## NEVER OWNS
- Arrhythmia as a diagnosis (fibrilácia, AV blok) → OA or Záver.
- EKG interpretation (PQ, QRS, ST-T) → EKG.
- BP → Krvný tlak.

## CRITICAL: NO INVENTION
Output ONLY the explicit heart-rate value stated in the source. Never fabricate a rate.

## FORMAT
- Compact: "65/min, pravidelný, plný" or "HR 51/min reg".
- Preserve the speaker's wording.

## WHEN EMPTY
If no heart rate is stated, output ZERO characters.`,
  },
  {
    id: "celkove-vysetrenie",
    labels: new Set([
      "celkove vysetrenie",
      "celkove vysetreni",
      "general examination",
      "physical examination",
      "objective findings",
    ]),
    context: `Celkové vyšetrenie — Physical examination findings from this encounter.

## OWNS — include ALL of these when mentioned in the source
- Level of consciousness, orientation, GCS.
- Cooperativeness, habitus, nutrition, hydration, skin (ikteru, cyanózy), periférne prekrvenie.
- Head exam: zrenice, fotoreakcia, nystagmus, sliznice, jazyk, šija.
- Chest exam: dýchanie (vezikulárne, bez VDF), hrudník symmetry.
- Cor auscultation: akcia, ozvy, šelesty.
- Abdomen: palpácia, rezistencie, peritoneálne dráždenie, peristaltika, Blumberg, Rovsing, Murphy, Plenci, tapott.
- Lower extremities: edémy, pulzácie, lýtka, Homans, HŽT / ischémia.
- Upper + lower limb strength (svalová sila).

## NEVER OWNS
- BP / HR / SpO2 / temperature → Krvný tlak / Pulz.
- EKG reading → EKG.
- Height / weight / BMI → their own sections.
- Lab values (troponin, NT-proBNP, CRP) → part of TO narrative for THIS encounter.
- Diagnoses → OA / Záver.
- Chronic history → OA.

## CRITICAL: NO INVENTION
Only include findings explicitly documented in the source. Do NOT add "normal" findings the doctor didn't state ("sliznice vlhké" only if the source says so).

## FORMAT
- One flowing paragraph of Slovak clinical prose, comma-separated compact facts grouped by anatomical system.
- Preserve abbreviations verbatim (VDF, GCS, HŽT, DK, HKK).
- No bullets, no subheadings.

## WHEN EMPTY
If no physical examination findings are in the source, output ZERO characters.`,
  },
  {
    id: "ekg",
    labels: new Set(["ekg", "ecg"]),
    context: `EKG — Electrocardiogram reading from this encounter.

## OWNS — include ALL of these when in the source
- Rhythm (sinusový, fibrilácia, flutter).
- Rate (frequency, f:).
- Axis (os elektrická) when stated.
- P-wave, PR / PQ interval.
- QRS width and morphology.
- ST segment (v izočiare, elevácia, depresia).
- T-wave changes (negatívne, invertované, vo zvodoch …).
- Conduction blocks (AV blok I./II./III. stupňa, LBBB, RBBB).
- SVES, VES when stated.
- The doctor's interpretive conclusion ("bez akútnych ischemických zmien", "AV blok 1. stupňa").

## NEVER OWNS
- BP / HR as a vital sign → Krvný tlak / Pulz. (Heart rate as part of the EKG reading stays here.)
- Physical exam → Celkové vyšetrenie.
- Diagnoses → Záver.
- Treatment → Postup a plán.

## CRITICAL: NO INVENTION
Only include EKG findings explicitly documented. Do NOT add "normal intervals" the doctor didn't read.

## FORMAT
- Compact one-line or short-sentence sequence, preserving the doctor's exact interval and wave wording.
- Example: "Sínusový rytmus, f 56/min, PQ 0,28 s, QRS do 0,08 s, ST v izočiare, T negat. V1–V3, AV blok 1. stupňa. Bez známok akútnych ischemických zmien."
- Preserve Slovak decimal comma (0,28 not 0.28).

## WHEN EMPTY
If no EKG reading is in the source, output ZERO characters.`,
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
