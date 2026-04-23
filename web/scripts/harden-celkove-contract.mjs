/**
 * Harden the "Celkové vyšetrenie" section contract across all templates.
 *
 * Observed failure: when the source has NO physical exam findings
 * (e.g. after a file-focus filter strips them, or for sources like a
 * phone consult), the model fills the slot with generic "normal exam"
 * boilerplate — "Dýchanie bez ráz. Srdce: pravidelný rytmus, bez
 * patologických šumov. Abdomen mäkký, bez bolestivosti. Dolné
 * končatiny bez edémov." — none of which appear in the source. This
 * is dangerous invention: these sound like doctor findings but
 * nobody actually performed the exam.
 *
 * Fix: rewrite the contract so the NO-INVENTION / empty-by-default
 * path is loud and the "normal exam boilerplate" failure mode is
 * explicitly called out and forbidden.
 *
 * Idempotent. Dry-run first.
 *
 * Usage:
 *   node scripts/harden-celkove-contract.mjs --dry-run
 *   node scripts/harden-celkove-contract.mjs
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

function norm(l) {
  return l
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[:\s]+$/g, "");
}

const LABELS = new Set([
  "celkove vysetrenie",
  "celkovy stav",
  "celkovy nalez",
  "fyzikalne vysetrenie",
  "fyzikalni vysetreni",
  "objektivne vysetrenie",
  "objektivni vysetreni",
  "physical examination",
  "general examination",
  "general condition",
  "physical exam",
  "exam",
  "pe",
]);

const NEW_CONTEXT = `Celkové vyšetrenie — zápis FYZICKÝCH NÁLEZOV, ktoré doktor reálne zistil v zdrojovom materiáli (transkript dikcie, priložené dokumenty).

## OWNS
- Vedomie / orientácia / GCS ak sú zdokumentované v zdroji.
- Habitus, výživa, hydratácia, koža (ikterus, cyanóza).
- Auskultačný nález srdca a pľúc, palpácia brucha, prehliadka hlavy, hrudníka, HKK/DKK — VŽDY IBA to, čo zdroj uvádza.
- Neurologické bedside zistenia (zrenice, reflexy, sila) ak sú zdokumentované.

## ABSOLÚTNY ZÁKAZ INVENCIE "NORMÁLNEHO NÁLEZU"
Bežná chyba: ak zdroj NEOBSAHUJE fyzikálne nálezy, model vypíše štandardnú "normálnu" šablónu — "Dýchanie bez ráz. Srdce pravidelný rytmus, bez patologických šumov. Abdomen mäkký, bez bolestivosti. Dolné končatiny bez edémov." ZAKÁZANÉ. Tieto vety znejú ako doktorov nález, ale v skutočnosti nikto vyšetrenie neurobil — to je invencia, ktorá môže uškodiť pacientovi.

Pravidlo: ak v zdroji NIE JE explicitný fyzikálny nález (konkrétny popis auskultácie / palpácie / neurologického nálezu doktorom), VRÁŤ PRÁZDNY REŤAZEC. Nikdy nevypisuj "defaultný normálny nález".

Signály, že zdroj OBSAHUJE fyzikálne nálezy (ktoré SMIEŠ použiť):
- Doktor v transkripte dikuje vyšetrenie ("dýchanie čisté, vezikulárne bilat.", "cor AP, ozvy ohraničené", "brucho mäkké, priehmatné, nebolestivé").
- Priložený dokument obsahuje Obj./Status praesens/Physical exam blok s konkrétnymi zisteniami.
- ZZS protokol má štruktúrovaný status (A/B/C/D) s popisom.

Signály, že zdroj NEOBSAHUJE fyzikálne nálezy (sekcia → prázdna):
- Transkript obsahuje iba rozhovor bez dikcie vyšetrenia.
- Priložený dokument je echokardiogram / laboratórny výsledok / lekárska správa BEZ status praesens bloku.
- File-focus filter zúžil dokument na sekcie, ktoré fyzikálne nálezy neobsahujú.

## NEVER OWNS
- BP → Krvný tlak. HR → Pulz. SpO2 / TT / hodnoty vitálov s číslami → príslušné sekcie.
- Výška / Hmotnosť / BMI → ich vlastné sekcie.
- EKG readings → EKG.
- Diagnózy → Záver. Chronická anamnéza → OA.
- Patientov rozprav / subjektívne sťažnosti → TO.

## NO INVENTION
Iba nálezy doslovne doložené v zdroji pre TOHTO pacienta v TOMTO kontakte. Žiadne defaulty, žiadne priemerné klinické obraty.

## WHEN EMPTY
Zdroj neobsahuje fyzikálne nálezy → vráť prázdny reťazec (zero characters). Nikdy nevypisuj "bez patológie" / "v norme" / "bez zmien" ako náhradu za chýbajúce vyšetrenie.`;

function matchesLabelSet(section, labelSet) {
  const labels = Object.values(section?.labels ?? {});
  for (const l of labels) {
    if (typeof l !== "string") continue;
    if (labelSet.has(norm(l))) return true;
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
    if (!matchesLabelSet(s, LABELS)) continue;
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
    console.error("Missing env vars");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: templates, error } = await sb
    .from("templates")
    .select("id, name, sections");
  if (error) {
    console.error("fetch failed:", error);
    process.exit(1);
  }

  console.log(
    `[celkove] fetched ${templates.length} template(s). DRY_RUN=${DRY_RUN}\n`,
  );

  let totalUpdated = 0;
  let totalSkipped = 0;
  let templatesWritten = 0;

  for (const t of templates) {
    const report = { updated: [], skipped: [] };
    const changed = walk(t.sections, report);
    const displayName = t.name?.sk || t.name?.en || t.id;
    if (!report.updated.length && !report.skipped.length) continue;
    for (const m of report.updated) {
      console.log(
        `  ✏  ${displayName} → "${m.label}" (${m.id}): ${m.oldLen} → ${m.newLen} chars`,
      );
      totalUpdated++;
    }
    for (const s of report.skipped) {
      console.log(
        `  =  ${displayName} → "${s.label}" (${s.id}): up to date. Skip.`,
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
    `\n[celkove] done: ${totalUpdated} updated, ${totalSkipped} skipped, ${templatesWritten} template(s) written${DRY_RUN ? " (DRY RUN)" : ""}.`,
  );
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
