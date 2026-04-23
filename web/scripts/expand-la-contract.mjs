/**
 * Expand the LA / medication section contract across all templates.
 *
 * Observed failure: the current contract ("aktuálna chronická medikácia
 * pacienta") restricted LA to long-term home meds. Acute medications
 * administered during the current encounter (ZZS on-scene treatment,
 * pre-transfer boluses, emergency ward drugs like Anopyrin 200 mg p.o.
 * 14:13, Brilique 180 mg p.o., Heparin 8000 UI i.v., Sufentanil i.v.)
 * were dropped entirely. Doctors want BOTH: chronic home meds +
 * acute-administered meds, ideally visually grouped.
 *
 * Fix: OWNS expanded to cover acute-administered meds with dose/route/
 * time where the source documents them. Format allows either one combined
 * list (as doctors sometimes write) or two labelled groups.
 *
 * Idempotent. Dry-run first.
 *
 * Usage:
 *   node scripts/expand-la-contract.mjs --dry-run
 *   node scripts/expand-la-contract.mjs
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

const LA_LABELS = new Set([
  "la",
  "liekova anamneza",
  "medication history",
  "medications",
  "meds",
  "mh",
  "aktualna medikacia",
  "aktualni medikace",
  "current medication",
  "current medications",
]);

const NEW_CONTEXT = `LA — všetka AKTUÁLNE užívaná medikácia pacienta: chronická domáca + lieky akútne podané počas dnešného kontaktu (ZZS, prevoz, CPO, ambulancia).

## OWNS
1. **Chronická domáca medikácia** — pravidelné lieky, ktoré pacient DNES stále užíva.
2. **Akútne podaná medikácia** — lieky podané počas dnešného kontaktu s posádkou ZZS, pred/počas prevozu, na CPO alebo v ambulancii. Uveď dávku, cestu podania a čas ak ich zdroj dokumentuje ("Anopyrin 200 mg p.o. 14:13", "Heparin 8000 UI i.v. 14:17").

Ak sú prítomné oba typy, najprv vymenuj chronickú liečbu, potom akútne podanú — buď v jednom zozname, alebo s krátkym oddelením ("Akútne podaná liečba:" / "Pri prevoze:"). Jediný typ v zdroji → uveď len ten. Žiadne medikácie v zdroji → vráť prázdny reťazec.

## STRICT FILTER — VYRADIŤ VYSADENÉ / UŽ NEUŽÍVANÉ LIEKY
Transkript často obsahuje lieky, ktoré pacient UŽ NEUŽÍVA — bral ich v minulosti, ukončil kurz, lekár zmenil/zrušil. Takéto lieky ÚPLNE VYNECHAJ z LA. Nezapisuj ich s poznámkou, nezapisuj ich prečiarknuto, nezapisuj ich vôbec — akoby neexistovali.

Signály v transkripte (zväčša v prvej osobe pacienta), že liek UŽ NEUŽÍVA:
- "už neberiem", "už nie", "to už nie", "neberem už"
- "prestal/a som brať", "dobehol/a som kurz", "dobral/a som si"
- "zrušili mi to", "vysadili mi to", "zmenili mi to na X", "nahradili mi to X-om"
- "vyhodil/a som si to sám/a", "som prestal/a brať"
- "to som bral/a iba počas toho kurzu", "počas toho, jak som bral X"
- "do [mesiaca/roku]" v minulosti (napr. transkript "do marca 2026" a dnes je po marci → liek je ukončený)

Príklady — čo VYNECHAŤ úplne:
- Transkript: "Efient už nie" → DROP Efient. Nezapisuj "Efient 10 mg (už neberiem)".
- Dokument: "Efient 10 mg (6 mes. do 03/2026)" + transkript "to už neberiem" → DROP Efient.
- Transkript: "Nolpazu... to už neberiem tiež" → DROP Nolpazu.
- Transkript: "Gabapentin som bral predtým, teraz Pregabalin" → DROP Gabapentin, KEEP Pregabalin.

Ak transkript mení dávkovanie AKTUÁLNE užívaného lieku, zapíš NOVÚ dávku, nie starú: transkript "teraz Pregabalin 75 mg ráno aj večer, po dvoch týždňoch 150 mg dva ráno dva večer" → \`Pregabalin 75 mg 1-0-1 (postupné zvyšovanie na 150 mg 1-0-1)\`.

## ŽIADNA PATIENTOVA PRVÁ OSOBA v položkách LA
Nikdy nezapíš pacientove 1st-person komentáre ako súčasť položky v LA. Zakázané: "(beriem tretinku)", "(beriem polku podľa tlaku)", "(keď sa mi dvihne tlak, tak celú)", "(bojím sa toho)", "(neviem si to)". Tieto poznámky patria do TO alebo sa úplne vynechávajú. Dávka nech je v štandardnom klinickom formáte ("1-0-0", "2,5 mg 1-0-0", "podľa potreby", "á 24h"), nie v patientovej reči.

## Formát
- Chronická liečba: \`Názov lieku dávka frekvencia\` — napr. "Egilok 25 mg 1/2-0-1/2", "Tamurox 1-0-0".
- Akútne podaná: \`Názov lieku dávka cesta čas\` — napr. "Anopyrin 200 mg p.o. 14:13", "Sufentanil 5 μg i.v. 14:39". Ak zdroj nemá niektorú hodnotu, vynechaj len ju.
- Zachovaj slovenské dávkovanie, frekvencie, cestu a čas presne ako sú v zdroji ("1-0-1", "ráno a večer", "podľa potreby", "sc à 24h", "p.o.", "i.v.").

## NEVER OWNS
- Alergie → AA.
- Diagnózy / klinický záver → OA alebo Záver.
- Plán ďalšej liečby po prepustení ("pokračovať v antiagregácii", "nasadiť statín") → Postup a plán.

## NO INVENTION
Iba lieky, ktoré sa v zdroji reálne nachádzajú. Každá položka musí mať oporu v medikačnej CSV (drug-normalizer); neznáme lieky sa odstraňujú.

## WHEN EMPTY
Žiadne aktuálne užívané lieky v zdroji → vráť prázdny reťazec.`;

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
    if (!matchesLabelSet(s, LA_LABELS)) continue;
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
    `[LA] fetched ${templates.length} template(s). DRY_RUN=${DRY_RUN}\n`,
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
    `\n[LA] done: ${totalUpdated} updated, ${totalSkipped} already-up-to-date, ${templatesWritten} template(s) written${DRY_RUN ? " (DRY RUN — no DB writes)" : ""}.`,
  );
}

main().catch((err) => {
  console.error("[LA] fatal:", err);
  process.exit(1);
});
