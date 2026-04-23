/**
 * Tighten the Pulz section contract across all templates.
 *
 * Observed failure: on ZZS-report sources with a timestamped VF table
 * (4 × HR readings 14:02/14:31/14:58/15:12), the model emitted a
 * timeline: "SF 68/min pri prvom meraní (14:02), následne 67/min
 * (14:31), 68/min (14:58), 78/min (15:12)" — AND duplicated palpation
 * findings that belong to Celkové vyšetrenie ("centrálny i periférny").
 *
 * Fix: require a SINGLE snapshot (or narrow range) plus rhythm, and
 * explicitly forbid timestamp lists + palpation narrative.
 *
 * Idempotent. Dry-run first.
 *
 * Usage:
 *   node scripts/tighten-pulz-contract.mjs --dry-run
 *   node scripts/tighten-pulz-contract.mjs
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

const PULZ_LABELS = new Set(["pulz", "sf", "heart rate", "hr", "pulse"]);

const NEW_CONTEXT = `Pulz — jedna krátka veta o srdcovej frekvencii a rytme pacienta.

## OWNS
- JEDNA hodnota srdcovej frekvencie (alebo úzky rozsah ako "68–78/min") + rytmus (pravidelný / nepravidelný) + prípadne plnosť (plný / slabý / nitkovitý).
- Ak zdroj obsahuje EKG reading s "SF X/min" alebo "f: X/min", použi tú.

## Formát (príklady)
- "68/min, pravidelný, plný."
- "SF 56/min, pravidelná."
- "68–78/min, pravidelný."

## NEVER OWNS (STRICT)
- **TIMESTAMP LISTS / TIMELINES** — nikdy nevypisuj zoznam meraní typu "68/min (14:02), 67/min (14:31), 68/min (14:58), 78/min (15:12)". Vyber jedno reprezentatívne meranie (zvyčajne prvé pri príjme) ALEBO úzky rozsah ("68–78/min"). Timeline patrí maximálne do Krvný tlak ak to doktor takto píše.
- **PALPATION NARRATIVE** — "centrálny pulz pravidelný, plný. periférny pulz pravidelný, plný. kapilárny návrat pod 2 sekundy" → to patrí do Celkové vyšetrenie, nie do Pulz.
- Krvný tlak → Krvný tlak.
- EKG intervaly / ST-T / blokády → EKG.
- Arytmia ako diagnóza → OA / Záver.

## Nepridávaj label
Sekcia je už označená "Pulz" — nezačínaj výstup slovom "Pulz". Vypíš iba samotné údaje ("68/min, pravidelný, plný.").

## NO INVENTION
Iba explicitná srdcová frekvencia z tohto zdroja.

## WHEN EMPTY
Žiadna HR v zdroji (ani v EKG čítaní) → vráť prázdny reťazec.`;

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
    if (!matchesLabelSet(s, PULZ_LABELS)) continue;
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
    `[pulz] fetched ${templates.length} template(s). DRY_RUN=${DRY_RUN}\n`,
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
    `\n[pulz] done: ${totalUpdated} updated, ${totalSkipped} skipped, ${templatesWritten} template(s) written${DRY_RUN ? " (DRY RUN)" : ""}.`,
  );
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
