/**
 * One-shot: REPLACE a matching section's `context` with a slim "contract
 * only" template. OWNS / NEVER OWNS / NO INVENTION / WHEN EMPTY — no
 * positive/negative examples, no verbose FORMAT prescription. Voice
 * and format live in the reference-notes corpus (`template.styleExamples`),
 * which the section-agent injects as few-shot examples at generation time.
 *
 * Backs up the previous context into `section.previousContext` so we can
 * roll back.
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
// Each entry: section labels + a slim contract. Voice/format lives in the
// reference-notes corpus (few-shot via template.styleExamples), not here.

const CANONICAL = [
  // ── RA ──────────────────────────────────────────────────────────────
  {
    id: "ra",
    labels: new Set(["ra", "rodinna anamneza", "family history", "fhx"]),
    context: `RA — Family history (relatives only).

## OWNS
- Diseases / conditions of parents, siblings, grandparents, children.
- Causes of death, ages at death or age-at-diagnosis.

## NEVER OWNS
- Patient's own chronic conditions or surgeries → OA.
- Spouse caregiving context → SA.
- Patient's habits → Ab. Patient's allergies → AA.

## NO INVENTION
Only relatives explicitly mentioned in the source. Never add "in good health" for a relative the patient didn't mention.

## WHEN EMPTY
No relative mentioned → output ZERO characters.`,
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
    context: `OA — Patient's chronic conditions + past surgeries brought into this encounter.

## OWNS
- Chronic diseases with staging/severity where stated.
- Past surgeries / procedures ("stav po …").
- Past injuries with lasting effects.
- Known tumours, MGUS, chronic neurological / psychiatric conditions.

## NEVER OWNS
- Current acute complaint → TO.
- Current medications → LA.
- Allergies → AA. Habits → Ab. Family diseases → RA.

## NO INVENTION
Only conditions explicitly stated as the patient's own.

## WHEN EMPTY
No chronic history in source → output ZERO characters.`,
  },

  // ── SA ──────────────────────────────────────────────────────────────
  {
    id: "sa",
    labels: new Set([
      "sa",
      "socialna anamneza",
      "socialni anamneza",
      "social history",
      "shx",
    ]),
    context: `SA — Social / living situation.

## OWNS
- Who the patient lives with.
- Caregiver duties or dependents.
- Living environment when relevant to care.

## NEVER OWNS
- Occupation → PA. Habits → Ab. Family diseases → RA.

## WHEN EMPTY
Output ZERO characters.`,
  },

  // ── PA ──────────────────────────────────────────────────────────────
  {
    id: "pa",
    labels: new Set([
      "pa",
      "pracovna anamneza",
      "pracovni anamneza",
      "occupational history",
      "ohx",
    ]),
    context: `PA — Occupation / professional history.

## OWNS
- Current or most recent job.
- Relevant occupational exposures (dust, chemicals, noise, radiation).
- Retirement status.

## NEVER OWNS
- Social / living → SA. Habits → Ab. Diseases → OA.

## WHEN EMPTY
Output ZERO characters.`,
  },

  // ── EA ──────────────────────────────────────────────────────────────
  {
    id: "ea",
    labels: new Set([
      "ea",
      "epidemiologicka anamneza",
      "epidemiological history",
      "ehx",
    ]),
    context: `EA — Epidemiological anamnesis: infectious exposures, vaccination, travel. NOTHING ELSE.

## OWNS
- Recent infections (active or just recovered), including past rashes like herpes zoster if clinically relevant.
- Vaccinations relevant to the current concern.
- Travel or contact with infectious persons in the last 1-6 months.
- Vector-borne exposure (tick bite, etc.).

## NEVER OWNS (STRICT — never backfill EA with these)
- Family diseases (otec, matka, súrodenci) → RA.
- Allergies / "neguje alergie" / "alergia na peľ" → AA.
- Habits (smoking, alcohol, drugs) / "neguje fajčenie" / "alkohol príležitostne" → Ab.
- Chronic non-infectious diseases (hypertenzia, CKD, divertikulóza) → OA.
- Current non-infectious complaint → TO.

EA is ONLY infectious exposures, vaccinations, travel, vector-borne contact. If the source has no such content, output ZERO characters — do NOT fill the slot with denials or mentions from other sections.

## NO INVENTION
Only infectious exposures/events the patient confirmed (or explicitly denied in an infectious context — "infekčné ochorenie neguje").

## WHEN EMPTY
No epidemiological content → output ZERO characters.`,
  },

  // ── AA ──────────────────────────────────────────────────────────────
  {
    id: "aa",
    labels: new Set(["aa", "alergicka anamneza", "allergies", "ahx", "ada"]),
    context: `AA — Allergies.

## OWNS
- Specific allergens the patient reports (drugs, foods, contrast, environmental) with reaction if stated.
- Explicit denial of allergies (when the patient said no, use a short attending-standard denial phrase — the corpus shows the preferred wording).

## NEVER OWNS
- Medications in general → LA.
- Drug side-effects without an allergic component → LA / OA.

## NO INVENTION
Only allergens explicitly named or denied by the patient.

## WHEN EMPTY
Allergies not discussed → output ZERO characters.`,
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
    context: `LA — Medications. EACH BRAND APPEARS EXACTLY ONCE. Output as ONE LINE, comma-separated (mirrors how attending notes render LA and how Postup a plán renders the continuing-med list).

## FORMAT (HARD)
Example:
"ANOPYRIN 100 mg, Arixtra 2,5 mg sc à 24h (15:00), Egilok 25 mg 1/2-0-1/2, PRESTARIUM A 5 mg 1/2-0-1/2, Trombex 75 mg 1-0-0, Suplasin raz za pol roka."

- Comma + space between meds. No newlines. End with a period.

## PRIMARY SOURCE: <STRUCTURED_FACTS>
If <STRUCTURED_FACTS> contains <MED/> entries, the preprocessor has already de-duplicated them (one entry per drug with the most informative dose + route + frequency). Copy each verbatim. Then add any brand from the transcript that isn't already listed.

## OWNS
- Chronic home medications (discharge / referral letter list).
- In-encounter administrations (Heparin, Aspirin, Arixtra).
- OTC / as-needed meds.
- Dose (number + unit), frequency verbatim (1-0-1, 1/2-0-1/2, ráno a večer, podľa potreby, sc à 24h), route (per os, sc, iv, im) when stated.

## NEVER OWNS
- Allergies → AA.
- Explicitly stopped meds ("prestala brať", "vysadené") → skip.
- Plan-level "začať statín" → Postup a plán.

## NO INVENTION
Never invent a dose, frequency, or route not stated in the source.

## WHEN EMPTY
No medications anywhere → output ZERO characters (rare — discharge letters almost always carry a list).`,
  },

  // ── Ab ──────────────────────────────────────────────────────────────
  {
    id: "ab",
    labels: new Set(["ab", "abuzy", "habits", "substance use"]),
    context: `Ab — Substance use (tobacco, alcohol, drugs).

## OWNS
- Smoking status + amount + duration.
- Alcohol frequency + type when stated.
- Illicit drugs + type when stated.
- Explicit denials ("nefajčí", "drogy neguje", "alkohol nepije").

## NEVER OWNS
- Allergies → AA. Occupation → PA. Diseases → OA. Family → RA.

## WHEN EMPTY
Output ZERO characters.`,
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
      "subjective",
      "subjektivne",
    ]),
    context: `TO — Current encounter narrative: story of the presenting complaint, admission timeline, findings during THIS hospitalisation.

## OWNS
- Onset + evolution of the presenting complaint.
- Referring doctor / ambulatory-work-up actions.
- Labs, imaging, procedures done during THIS admission.
- Symptom changes during the stay.
- Transfer / admission reason.

## NEVER OWNS
- Chronic conditions → OA. Family → RA. Occupation → PA. Social → SA. Habits → Ab. Allergies → AA.
- Medications list → LA. Final diagnoses → Záver. Post-discharge plan → Postup a plán.

## NO INVENTION
Only events the source documents for THIS encounter. Do not repeat content that belongs in another section.

## WHEN EMPTY
No current-encounter narrative → output ZERO characters.`,
  },

  // ── Záver ───────────────────────────────────────────────────────────
  {
    id: "zaver",
    labels: new Set([
      "zaver",
      "zavěr",
      "assessment",
      "conclusion",
      "diagnosis",
      "diagnostic assessment",
    ]),
    context: `Záver — Diagnostic summary with ICD-10 codes. Each entry: "CODE Description". Comma- or newline-separated.

## OWNS — INCLUDE EVERY DIAGNOSIS. A complete Záver lists 5-12 entries for a typical cardiology admission.
- Primary encounter diagnosis FIRST (what drove this visit).
- EVERY chronic condition the OA documents — hypertension, arrhythmia, CKD, diabetes, GERD, divertikulóza, operations (st.p.), etc. Each gets its own ICD-10 entry.
- Diagnoses the discharge letter / referral explicitly wrote in its "Diagnostický záver" / "Dg:" / "Assessment" block — these ARE confirmed clinician-written diagnoses, include them.
- New diagnoses made during THIS encounter that the clinician explicitly named (e.g. "SZpEF novodiagnostikované" — it's in the source as a diagnosis, include it).

A short Záver (1-2 codes) is almost always a mistake — re-read OA and the OCR's diagnostic block.

## ICD-10 FORMAT (HARD)
- WHO Slovak ICD-10 only. A code looks like \`Letter + 2 digits\` + optional \`.digit\` or \`.digit-digit\`.
- REJECT ICD-10-CM codes with 3+ digits after the decimal: \`Z87.891\`, \`E66.01\`, \`I71.20\`. (\`I25.10\` with 2 decimal digits IS valid in Slovak CSV.)
- If you don't know the exact code, use the 3-char root (\`I25\` instead of guessing \`I25.99\`). Better an honest root than an invented subcode.

## NO FABRICATION / NO INFERENCE (but also no timidity)
- Never output a code for a condition the patient DENIED. Transcript "teplotu nemal" → \`R50.9 Horúčka\` is forbidden.
- Do NOT derive a diagnosis from a raw imaging or lab finding when the clinician did NOT write it as a diagnosis. CT "dilatácia aorty" with no assigned diagnosis ≠ \`I71.2\`. But if the discharge letter's Diagnostický záver block says "SZpEF" — that IS the clinician's diagnosis, include it.
- Do not derive a diabetes code from a single glucose value.
- When the patient named specific allergens, do NOT use \`Z88.9\` filler — either use the specific allergen code or omit.

## PRIMARY + DIFFERENTIAL
If the primary is a symptom awaiting work-up (e.g. \`R07.4\`), attach the differential in parentheses:
\`R07.4 Bolesť v hrudníku (diferenciálna dg.: nemožno vylúčiť NSTEMI)\`.

## NEVER OWNS
- Narrative of how the diagnosis unfolded → TO.
- Treatment / procedures → Postup a plán.
- Family diseases → RA. Allergies → AA.

## WHEN EMPTY
No diagnostic content in source at all (extremely rare) → output ZERO characters.`,
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
    context: `Postup a plán — Treatment plan + procedures + follow-up + discharge instructions.

## OWNS
- Planned procedures (koronarografia, EKV, intervencie).
- Transfer destination.
- Continuing home medications (repeat of LA is OK for transfer summaries).
- Dietary / lifestyle / režimové opatrenia.
- Follow-up schedule / dispenzár.
- Boilerplate discharge statement ("Pacient/ka poučený/á …").

## NEVER OWNS
- Diagnoses → Záver. Current-encounter events → TO. Chronic diseases → OA.

## NO INVENTION
Only procedures/plans stated in the source.

## WHEN EMPTY
Output ZERO characters.`,
  },

  // ── Výška ────────────────────────────────────────────────────────────
  {
    id: "vyska",
    labels: new Set(["vyska", "výška", "height"]),
    context: `Výška — Patient's height in cm.

## OWNS
- A single height value in cm. If <STRUCTURED_FACTS> has <VITAL key="height" value="…"/>, output that value verbatim — nothing else.

## NEVER OWNS
- Weight → Hmotnosť. BMI → BMI. Vitals → Krvný tlak / Pulz. Exam → Celkové vyšetrenie.

## NO INVENTION
Never guess. Never pick a "plausible" default.

## WHEN EMPTY
No height anywhere → output ZERO characters.`,
  },

  // ── Hmotnosť ─────────────────────────────────────────────────────────
  {
    id: "hmotnost",
    labels: new Set(["hmotnost", "weight"]),
    context: `Hmotnosť — Patient's weight in kg.

## OWNS
- A single weight value in kg. If <STRUCTURED_FACTS> has <VITAL key="weight" value="…"/>, output that value verbatim — nothing else.

## NEVER OWNS
- Height → Výška. BMI → BMI. Vitals → Krvný tlak / Pulz. Exam → Celkové vyšetrenie.

## NO INVENTION
Never guess. Never pick a "plausible" default.

## WHEN EMPTY
No weight anywhere → output ZERO characters.`,
  },

  // ── BMI ──────────────────────────────────────────────────────────────
  {
    id: "bmi",
    labels: new Set(["bmi"]),
    context: `BMI — Body Mass Index.

## OWNS
- BMI value. If <STRUCTURED_FACTS> has <VITAL key="bmi" value="…"/>, output that value verbatim.
- Otherwise compute BMI = weight(kg) / height(m)² ONLY when both are explicitly stated. Slovak decimal comma (27,9).

## NEVER OWNS
- Any other content.

## NO INVENTION / NO INFERENCE
Never output a BMI without both inputs or a stated BMI. Never estimate.

## WHEN EMPTY
Neither value available → output ZERO characters.`,
  },

  // ── Krvný tlak ───────────────────────────────────────────────────────
  {
    id: "krvny-tlak",
    labels: new Set([
      "krvny tlak",
      "krevni tlak",
      "tlak",
      "blood pressure",
      "bp",
    ]),
    context: `Krvný tlak — ONLY explicit NUMERIC blood pressure in mmHg.

## OWNS
- Systolic/diastolic value in mmHg (e.g. "120/80 mmHg").
- Limb (ĽHK / PHK) when stated.
- Position (sediac / ležiac / v stoji) when stated.
- Multi-timepoint BP measurements with timestamps.

## NEVER OWNS (STRICT REDIRECTS)
- Heart rate / HR / SF N/min → Pulz. Even when it appears next to BP in the same vitals block, it is NOT yours.
- SpO2 / SaO2; temperature; respiratory rate → not yours.
- Hypertension as a diagnosis → OA / Záver. Antihypertensive medication → LA. Exam → Celkové vyšetrenie.

## NO INVENTION / NO QUALITATIVE DESCRIPTORS
- Only output explicit NUMERIC BP values in mmHg.
- Qualitative descriptors WITHOUT a number ("zvýšený tlak", "vysoký tlak", "normálny tlak", "tlak v norme") → output ZERO characters. The patient's narrative about their pressure belongs in OA / Záver as a hypertension diagnosis, not here.

## WHEN EMPTY
No numeric BP value anywhere → output ZERO characters.`,
  },

  // ── Pulz ─────────────────────────────────────────────────────────────
  {
    id: "pulz",
    labels: new Set([
      "pulz",
      "tep",
      "srdcova frekvencia",
      "heart rate",
      "pulse",
    ]),
    context: `Pulz — ONLY the heart-rate reading.

## OWNS
- Rate per minute, rhythm (pravidelný / nepravidelný), volume (plný / slabý), central/peripheral distinction.
- HR pulled from an EKG reading ("SF 70/min", "frekvencia 56/min") counts. If <STRUCTURED_FACTS> has <VITAL key="hr" value="…"/>, use that verbatim.

## NEVER OWNS (STRICT REDIRECTS)
- Height → Výška. Weight → Hmotnosť. BMI → BMI.
- EKG interpretation (PQ, QRS, ST-T, blocks) → EKG.
- BP → Krvný tlak.
- Arrhythmia as a diagnosis → OA / Záver.

## NO INVENTION
Only an explicit HR.

## WHEN EMPTY
No HR anywhere (including EKG readings) → output ZERO characters.`,
  },

  // ── Celkové vyšetrenie ───────────────────────────────────────────────
  {
    id: "celkove-vysetrenie",
    labels: new Set([
      "celkove vysetrenie",
      "celkove vysetreni",
      "general examination",
      "physical examination",
      "objective findings",
    ]),
    context: `Celkové vyšetrenie — Physical examination findings.

## OWNS
- Consciousness / orientation / GCS.
- Habitus, nutrition, hydration, skin (ikteru, cyanózy).
- Head exam, chest/dýchanie, heart auscultation, abdomen, DKK/HKK.
- Neurological bedside findings (when part of an internal exam).

## NEVER OWNS
- BP → Krvný tlak. HR → Pulz. SpO2 / TT. EKG → EKG.
- Height / weight / BMI → their own sections.
- Diagnoses → Záver. Chronic history → OA.

## NO INVENTION
Only findings explicitly documented.

## WHEN EMPTY
Output ZERO characters.`,
  },

  // ── EKG ──────────────────────────────────────────────────────────────
  {
    id: "ekg",
    labels: new Set(["ekg", "ecg", "ekg nalez", "ekg reading"]),
    context: `EKG — EKG reading from this encounter.

## OWNS
- Rhythm, rate, axis, P-wave, PR / PQ, QRS width + morphology, ST segment, T-wave, conduction blocks, extrasystoles (SVES, KES).
- Interpretive conclusion from the report.
- If <STRUCTURED_FACTS> has <EKG><READING>…</READING></EKG>, use that content verbatim.

## NEVER OWNS
- HR as a vital sign → Pulz (the EKG line's own rate stays here).
- Exam → Celkové vyšetrenie. Diagnoses → Záver. Treatment → Postup a plán.

## NO INVENTION
Only findings explicitly in the EKG report. Slovak decimal comma (0,28).

## WHEN EMPTY
Output ZERO characters.`,
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
