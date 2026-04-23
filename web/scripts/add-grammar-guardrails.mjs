/**
 * Add two template-wide grammar guardrails that apply to every section:
 *
 * 1. Capitalization — every sentence starts with a capital letter, and
 *    the first letter after a period is capitalized.
 *
 * 2. Gender agreement — infer the patient's sex from the source (spouse
 *    noun, gendered occupation, verb endings) and keep ALL gendered
 *    wordings consistent. Slovak marks gender on nouns, adjectives, and
 *    past-tense verbs; mixing them produces jarring notes (e.g.
 *    "dôchodkyňa ... žije s manželkou" → female retiree who has a wife).
 *
 * Idempotent. Dry-run first.
 *
 * Usage:
 *   node scripts/add-grammar-guardrails.mjs --dry-run
 *   node scripts/add-grammar-guardrails.mjs
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
const MARKER = "# Capitalization";

const APPENDED_BLOCK = `

# Capitalization
- Start every sentence with a capital letter. After a period, the next word's first letter is capitalized.
- This applies even in list-like sections where you write short clauses separated by periods ("Nefajčí. Alkohol pri príležitosti. Drogy neguje.").
- Abbreviations already in the source keep their original casing (st.p., MGUS, ICHS, NSTEMI — do not recapitalize).

# Gender agreement (Slovak)
Before writing, infer the patient's sex from the source. Signals: spouse noun ("manžel" → patient is female; "manželka" → patient is male), gendered occupation ("dôchodkyňa", "učiteľka", "sestra" → female; "dôchodca", "učiteľ", "lekár" → male), past-tense verb endings ("uviedla" → female; "uviedol" → male), and explicit address ("pán", "pani").

Once you've picked the patient's sex, keep ALL gendered nouns, adjectives, and past-tense verbs consistent with that sex throughout the note:
- Male patient: "dôchodca", "fajčiar", "uviedol", "bol hospitalizovaný", "žije s manželkou".
- Female patient: "dôchodkyňa", "fajčiarka", "uviedla", "bola hospitalizovaná", "žije s manželom".

Never mix — e.g. "dôchodkyňa … žije s manželkou" is contradictory for one patient. If the source is inconsistent (rare), prioritize the most specific signal (spouse noun and direct address outrank occupation), and keep the rest of the note aligned with that choice.`;

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
    .select("id, name, system_prompt");
  if (error) {
    console.error("Failed to fetch templates:", error);
    process.exit(1);
  }

  console.log(
    `[grammar] fetched ${templates.length} template(s). DRY_RUN=${DRY_RUN}\n`,
  );

  let totalUpdated = 0;
  let totalSkipped = 0;
  let templatesWritten = 0;

  for (const t of templates) {
    const displayName = t.name?.sk || t.name?.en || t.id;
    const current = t.system_prompt || "";
    if (current.includes(MARKER)) {
      console.log(`  =  ${displayName}: marker already present. Skip.`);
      totalSkipped++;
      continue;
    }
    const next = current + APPENDED_BLOCK;
    console.log(
      `  ✏  ${displayName}: system_prompt ${current.length} → ${next.length} chars`,
    );
    totalUpdated++;

    if (!DRY_RUN) {
      const { error: upErr } = await sb
        .from("templates")
        .update({ system_prompt: next })
        .eq("id", t.id);
      if (upErr) {
        console.error(`  ✖  ${displayName}: update failed:`, upErr);
        continue;
      }
      templatesWritten++;
    }
  }

  console.log(
    `\n[grammar] done: ${totalUpdated} updated, ${totalSkipped} skipped, ${templatesWritten} template(s) written${DRY_RUN ? " (DRY RUN — no DB writes)" : ""}.`,
  );
}

main().catch((err) => {
  console.error("[grammar] fatal:", err);
  process.exit(1);
});
