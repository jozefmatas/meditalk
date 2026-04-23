/**
 * Tighten the TO / HPI section contract across all templates.
 *
 * Observed failure: the current contract "Labs, imaging, procedures
 * done during THIS admission" was read too permissively — models swept
 * raw vitals, EKG readings (rhythm/rate/ST), full physical exam, and
 * administered medications with doses/times into TO. Those sections
 * all exist separately (Krvný tlak, Pulz, EKG, Celkové vyšetrenie,
 * Postup a plán) and were left empty or duplicated.
 *
 * Fix: narrow "labs/imaging" to a one-sentence summary of key findings,
 * add explicit NEVER OWNS for vitals, EKG readings, physical exam,
 * administered meds with doses/times.
 *
 * Idempotent. Dry-run first.
 *
 * Usage:
 *   node scripts/tighten-to-contract.mjs --dry-run
 *   node scripts/tighten-to-contract.mjs
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

function normalizeLabel(l) {
  return l
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[:\s]+$/g, "");
}

const TO_LABELS = new Set([
  "to",
  "terajsie ochorenie",
  "prezentacia",
  "hpi",
  "history of present illness",
  "present illness",
  "ha",
  "hlavna anamneza",
  "anamneza teraz",
]);

const NEW_CONTEXT = `TO — Current encounter narrative: chronological clinical story of today's presenting complaint and its work-up.

## OPENING (preferred style for planned admissions / transfers)
Begin with a one-sentence snapshot of the patient followed by the admission purpose, then the subjective complaint chronology. Format:

"[Vek]-ročný/á pacient/ka, s [CHRONICKÉ MEDICÍNSKE KOMORBIDITY relevantné pre dnešný dôvod prijatia — AH, DLP, DM, obezita, známa ICHS, CHOCHP, CKD, …], [po kľúčových prekonaných KARDIOVASKULÁRNYCH intervenciách, napr. "po PCI + DES mid.RIA 09/2025", "po CABG", "po AVR"], bol/a prijatý/á na naše pracovisko za účelom [dôvod prijatia]. Subjektívne sa pacient/ka sťažuje na [príznaky]. Od [kedy] …"

Co je "rizikový faktor / komorbidita" pre opener: CHRONICKÉ DIAGNÓZY z OA, ktoré súvisia s dôvodom prijatia (hypertenzia, diabetes, dyslipidémia, obezita, predchádzajúce MI/PCI/CABG/CABG, CKD, CHOCHP), prípadne aktívny fajčiar ako samostatný pojem. NIE je to: rodinná anamnéza (RA), sociálna situácia (SA), zamestnanie (PA), bežné návyky okrem fajčenia (Ab), alergie (AA), všetky úrazy/nesúvisiace st.p. z OA. Tie patria do VLASTNÝCH sekcií a NIKDY sa nerepetujú v TO.

Examples (placeholders in square brackets represent data the source must provide — never output literal placeholders):
- "[Vek]-ročný pacient, s artériovou hypertenziou, hyperlipidémiou a obezitou, so známou koronárnou chorobou s dvojcievnym postihnutím, po PCI + 2× DES mid.RIA (09/2025), bol prijatý na naše pracovisko za účelom rekoronarografie a zváženia pokračujúcej PCI pre recidívu bolesti na hrudníku. Subjektívne sa pacient sťažuje na pretrvávajúcu námahovú dušnosť a tlak na hrudi…"
- "[Vek]-ročná pacientka s nekomplikovanou hypertenziou bola prijatá na internú JIS v Malackách pre progresiu dýchavice a pichavé bolesti v strede hrudníka. Subjektívne udáva…"

## VEK — NIKDY NEVYMÝŠĽAJ
Vek uvádzaj IBA ak ho zdroj EXPLICITNE uvádza (transkript "mám 82 rokov", dokument "82-ročná pacientka", OCR "RČ 445412..." s jednoznačným výpočtom dátum narodenia). NIKDY nehádaj vek z kontextu (komorbidity, habitus, "starecká cukrovka" atď.) — to je invencia.

Ak zdroj vek neuvádza:
- Vynechaj prvý slot úplne a začni "Pacient/ka, s [rizikové faktory], …" alebo "U pacienta/pacientky s [rizikové faktory] …".
- Príklad: "Pacient, s artériovou hypertenziou, hyperlipidémiou a obezitou, so známou koronárnou chorobou …, bol prijatý na naše pracovisko za účelom …"
- Nerieš vek. Prázdny slot je VŽDY lepší ako uhádnuté číslo.

This opener is preferred for planned admissions, transfers, and elective procedures where the source provides enough data. For sparse acute sources (e.g. a ZZS snapshot with only "od rána bolesť"), a shorter chronological opener is fine — but always keep 3rd-person clinical voice.

## OWNS
- The OPENING sentence above.
- Onset, evolution, and timeline of the presenting complaint — rephrase patient's 1st-person quotes into 3rd-person clinical prose ("mám pálenie" → "udáva pálenie").
- Referring doctor / ambulatory work-up actions and their conclusion ("internistka odoslala na CPO", "obvoďačka nasadila striek pod jazyk", "Dr. Baldovský navrhol rekoronarografiu").
- **Key imaging and lab findings** that shape the diagnosis or admission rationale — integrate them inline where clinically relevant. Examples of what belongs: "absolvoval echokardiografiu, ktorá potvrdila poruchovú systolickú funkciu ľavej komory EF 50% s hypokinézou v povodí RCX", "peak hsTNT 289.7 ng/l", "CT AG vylúčila embolizáciu do AP", "RTG bez ložiskových zmien". These are NOT raw readings — they are the CLINICAL TAKE-AWAY from the investigation, written as one clause inside the narrative.
- Admission / transfer reason ("preložená do CINRE za účelom SKG").
- Symptom course during the stay (improvement, recurrence, response to nitrát / analgézia).
- Patient's concerns / relevant prior complications that influence today's approach ("obavy z hematómu po predchádzajúcej punkcii cez stehno, ktorá si vyžiadala predĺženú hospitalizáciu").

## NEVER OWNS
- Physical exam findings (auscultation, palpation, neurological status, pupils) → Celkové vyšetrenie / Objektívne vyšetrenie.
- **Raw vital signs timelines** — timestamped TK/HR/DF/SpO₂ lists ("TK 150/80 (14:02), 145/80 (14:31), 143/80 (15:12)") → Krvný tlak / Pulz / respective sections.
- Full EKG readings (PQ, QRS, axis, detailed ST-T description) → EKG section. Naming the EKG finding in ONE clause as part of the narrative IS fine ("EKG bez ischem. zmien", "EKG s ST eleváciami v aVL, I"); dumping the full reading is not.
- Administered medications with doses and times ("Anopyrin 200 mg p.o. 14:13", "HEPARIN 8000 UI i.v. 14:17") → Postup a plán / LA.
- Chronic conditions full list → OA. (Opener may reference 2–4 relevant items in one phrase; do NOT re-list them all.)
- **Family history ("otec zomrel na…", "matka s problémami so srdiečkom")** → RA only.
- **Occupation / workplace ("učiteľka slovenčiny", "bezpečnostná služba")** → PA only.
- **Social situation ("žije sama", "žije s manželom s Alzheimerom")** → SA only.
- **Habits ("nefajčí", "alkohol príležitostne")** → Ab only. (Opener may mention "aktívny fajčiar" as a cardiovascular risk factor in ONE phrase — nothing more.)
- Allergies → AA.
- Medication LIST (the patient's regular meds) → LA. Final diagnoses → Záver. Post-discharge plan → Postup a plán.
- **DO NOT duplicate** content of RA/SA/PA/Ab/AA/LA at the end of TO. Those sections render their own text — repeating in TO bloats the note.

## STYLE
- 3rd-person clinical voice (see the template-wide voice guardrail).
- Typical length 5–10 sentences — longer for complex referrals with meaningful work-up, shorter for straightforward acute presentations.
- Flow: OPENER → SUBJECTIVE CHRONOLOGY → WORK-UP / KEY FINDINGS → ADMISSION REASON / PLANNED APPROACH → PATIENT CONCERNS (if relevant).
- Preserve clinical abbreviations ("ECHO KG", "TNT", "RCX", "PKI", "SKG", "CT AG", "DES") verbatim.

## NO INVENTION
Only events and findings the source documents for THIS encounter. Do not repeat content that belongs in another section.

## WHEN EMPTY
No current-encounter narrative in the source → output ZERO characters.`;

function matchesLabelSet(section, labelSet) {
  const labels = Object.values(section?.labels ?? {});
  for (const l of labels) {
    if (typeof l !== "string") continue;
    if (labelSet.has(normalizeLabel(l))) return true;
  }
  return false;
}

function walk(sections, report) {
  if (!Array.isArray(sections)) return false;
  let changed = false;
  for (const s of sections) {
    if (s.subsections?.length) {
      if (walk(s.subsections, report)) changed = true;
      continue;
    }
    if (!matchesLabelSet(s, TO_LABELS)) continue;
    const label = Object.values(s.labels ?? {})[0] ?? s.id;
    if (s.context === NEW_CONTEXT) {
      report.skipped.push({ id: s.id, label });
      continue;
    }
    report.updated.push({
      id: s.id,
      label,
      oldLen: (s.context ?? "").length,
      newLen: NEW_CONTEXT.length,
    });
    s.context = NEW_CONTEXT;
    changed = true;
  }
  return changed;
}

async function main() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: templates, error } = await sb
    .from("templates")
    .select("id, name, sections");
  if (error) {
    console.error("Failed to fetch templates:", error);
    process.exit(1);
  }

  console.log(
    `[TO] fetched ${templates.length} template(s). DRY_RUN=${DRY_RUN}\n`,
  );

  let totalUpdated = 0;
  let totalSkipped = 0;
  let templatesWritten = 0;

  for (const t of templates) {
    const report = { updated: [], skipped: [] };
    const changed = walk(t.sections, report);
    const displayName =
      (t.name && (t.name.en || t.name.sk || Object.values(t.name)[0])) ?? t.id;
    if (!report.updated.length && !report.skipped.length) continue;
    for (const m of report.updated) {
      console.log(
        `  ✏  ${displayName} → "${m.label}" (${m.id}): context ${m.oldLen} → ${m.newLen} chars`,
      );
      totalUpdated++;
    }
    for (const s of report.skipped) {
      console.log(
        `  =  ${displayName} → "${s.label}" (${s.id}): already up to date. Skip.`,
      );
      totalSkipped++;
    }

    if (changed && !DRY_RUN) {
      const { error: upErr } = await sb
        .from("templates")
        .update({ sections: t.sections })
        .eq("id", t.id);
      if (upErr) {
        console.error(`  ✖  ${displayName}: update failed:`, upErr);
        continue;
      }
      templatesWritten++;
    }
  }

  console.log(
    `\n[TO] done: ${totalUpdated} updated, ${totalSkipped} already-up-to-date, ${templatesWritten} template(s) written${DRY_RUN ? " (DRY RUN — no DB writes)" : ""}.`,
  );
}

main().catch((err) => {
  console.error("[TO] fatal:", err);
  process.exit(1);
});
