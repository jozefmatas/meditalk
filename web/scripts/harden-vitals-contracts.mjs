/**
 * Harden Výška / Hmotnosť / BMI section contracts across all templates.
 *
 * Observed failure: even after skipping voice examples for these single-
 * value structural sections (see pipeline.ts isStructuralVitalLabel),
 * the model still hallucinates "170 cm / 90 kg / 27,9" on sources that
 * contain NO height/weight at all. The current contracts are too
 * permissive — they describe what the section OWNS ("a single height
 * value in cm") but the "WHEN EMPTY" rule sits at the bottom and the
 * model treats the vitals slot as a "must-fill" field.
 *
 * Fix: rewrite contracts so the NO-INVENTION rule is loud and the empty
 * case is the default path. The contract now says in plain Slovak:
 * "if no explicit value in THIS patient's source, return empty — empty
 * is BETTER than invented."
 *
 * Idempotent. Dry-run first.
 *
 * Usage:
 *   node scripts/harden-vitals-contracts.mjs --dry-run
 *   node scripts/harden-vitals-contracts.mjs
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

const CONTRACTS = {
  vyska: `Výška — výška pacienta v cm.

## OWNS
Iba JEDNA konkrétna hodnota výšky, ktorá sa DOSLOVA nachádza v zdroji tohto pacienta (transkript alebo priložené dokumenty). Pravidlo: ak v TOMTO zdroji nevidíš slovo "Výška:", "cm" s číslom, alebo slovné vyjadrenie výšky od pacienta, hodnotu NEEMITUJ.

## ABSOLÚTNY ZÁKAZ INVENCIE
Ak zdroj tohto pacienta neobsahuje konkrétne číslo výšky:
- Vráť PRÁZDNY REŤAZEC. Žiadny text, žiadne číslo, žiadne vysvetlenie.
- NIKDY neuhádni "priemernú" alebo "typickú" výšku (napr. 170, 175, 180).
- NIKDY nepoužij hodnotu z reference notes / style examples / iných pacientov.
- NIKDY nenapíš vetu typu "Výška sa v zdroji nenachádza" — vráť naozaj prázdny výstup.

Prázdna sekcia je VŽDY lepšia ako vymyslené číslo. Neexistuje "rozumná" obrana pre invenciu vitals.

## WHEN EMPTY
Žiadna explicitná výška v zdroji → vráť prázdny reťazec (zero characters).`,

  hmotnost: `Hmotnosť — hmotnosť pacienta v kg.

## OWNS
Iba JEDNA konkrétna hodnota hmotnosti, ktorá sa DOSLOVA nachádza v zdroji tohto pacienta (transkript alebo priložené dokumenty). Pravidlo: ak v TOMTO zdroji nevidíš slovo "Hmotnosť:", "kg" s číslom, alebo slovné vyjadrenie hmotnosti od pacienta, hodnotu NEEMITUJ.

## ABSOLÚTNY ZÁKAZ INVENCIE
Ak zdroj tohto pacienta neobsahuje konkrétne číslo hmotnosti:
- Vráť PRÁZDNY REŤAZEC. Žiadny text, žiadne číslo, žiadne vysvetlenie.
- NIKDY neuhádni "priemernú" alebo "typickú" hmotnosť (napr. 70, 80, 90).
- NIKDY nepoužij hodnotu z reference notes / style examples / iných pacientov.
- NIKDY nenapíš vetu typu "Hmotnosť sa v zdroji nenachádza" — vráť naozaj prázdny výstup.

Prázdna sekcia je VŽDY lepšia ako vymyslené číslo. Neexistuje "rozumná" obrana pre invenciu vitals.

## WHEN EMPTY
Žiadna explicitná hmotnosť v zdroji → vráť prázdny reťazec (zero characters).`,

  bmi: `BMI — Body Mass Index.

## OWNS
BMI hodnota získaná IBA dvoma spôsobmi:
1. Zdroj uvádza BMI explicitne (napr. "BMI: 27,9") → výstup "27,9".
2. Zdroj explicitne uvádza OBIDVE hodnoty — výšku v cm aj hmotnosť v kg — pre TOHTO pacienta. Potom vypočítaj BMI = hmotnosť(kg) / (výška(m))² so slovenskou desatinnou čiarkou ("27,9" nie "27.9").

## ABSOLÚTNY ZÁKAZ INVENCIE
Ak zdroj neobsahuje BMI ANI obidve vstupné hodnoty:
- Vráť PRÁZDNY REŤAZEC. Žiadny text, žiadne číslo, žiadne vysvetlenie.
- NIKDY neodhaduj BMI z veku, pohlavia alebo habitu.
- NIKDY nepoužij hodnotu z reference notes / style examples / iných pacientov ("27,9", "28,1" sú častotné hodnoty príkladov — nikdy nevymýšľaj).
- NIKDY nenapíš vetu typu "BMI nie je možné vypočítať" — vráť naozaj prázdny výstup.

Prázdna sekcia je VŽDY lepšia ako vymyslené číslo.

## WHEN EMPTY
Ani BMI, ani obidve vstupné hodnoty v zdroji → vráť prázdny reťazec (zero characters).`,
};

const LABEL_MAP = {
  vyska: ["vyska", "height"],
  hmotnost: ["hmotnost", "weight"],
  bmi: ["bmi"],
};

function pickContract(section) {
  const labels = Object.values(section?.labels ?? {});
  for (const [key, aliases] of Object.entries(LABEL_MAP)) {
    for (const l of labels) {
      if (typeof l !== "string") continue;
      if (aliases.includes(norm(l))) return key;
    }
  }
  return null;
}

function walk(sections, report) {
  if (!Array.isArray(sections)) return false;
  let changed = false;
  for (const s of sections) {
    if (s.subsections?.length) {
      if (walk(s.subsections, report)) changed = true;
      continue;
    }
    const key = pickContract(s);
    if (!key) continue;
    const label = Object.values(s.labels ?? {})[0] ?? s.id;
    const nextContext = CONTRACTS[key];
    if (s.context === nextContext) {
      report.skipped.push({ id: s.id, label });
      continue;
    }
    report.updated.push({
      id: s.id,
      label,
      oldLen: (s.context ?? "").length,
      newLen: nextContext.length,
    });
    s.context = nextContext;
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
    `[vitals] fetched ${templates.length} template(s). DRY_RUN=${DRY_RUN}\n`,
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
    `\n[vitals] done: ${totalUpdated} updated, ${totalSkipped} skipped, ${templatesWritten} template(s) written${DRY_RUN ? " (DRY RUN)" : ""}.`,
  );
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
