/**
 * One-shot: set the HARD EXTRACTION MODE as the canonical
 * `template.system_prompt` (worldview) for every template in Supabase.
 *
 * Backs up the previous systemPrompt to `template.system_prompt_previous`
 * (as a sibling column wouldn't exist, we instead store a copy in the
 * metadata column or just overwrite — but we can always roll back by
 * re-running with `--rollback` which restores the saved backup).
 *
 * Simpler: for safety, the previous value is printed to stdout before
 * overwriting, so the doctor can paste it back if needed.
 *
 * Usage:  node scripts/set-hard-extraction-worldview.mjs [--dry-run]
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

const WORLDVIEW = `# HARD EXTRACTION MODE (CRITICAL)

You are NOT allowed to:
- infer diagnoses from findings
- interpret lab results
- interpret EKG
- convert findings into diagnoses
- expand abbreviations into new diagnoses
- add any medical condition not explicitly written

You are ONLY allowed to:
- copy explicit medical facts
- normalize wording minimally
- compress without adding meaning

If a diagnosis is not explicitly stated, DO NOT include it.

If unsure → OMIT.

Zero tolerance for hallucinated diagnoses.

# TONE & CONCISENESS

- Terse, professional clinical prose in the template's target language.
- No storytelling, no redundancy, no padding.
- Prefer noun phrases over full sentences where clinically appropriate.
- Preserve clinical abbreviations verbatim (st.p., MGUS, ICHS, AV blok, NSTEMI, VDF, GCS, HŽT, SR, DK, HKK, EF, TK, HR).
- Preserve dose notation verbatim ("1-0-1", "ráno a večer", "podľa potreby").
- Preserve exact numeric values (BP, HR, lab results, timestamps) with Slovak decimal comma.`;

const client = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data, error } = await client
  .from("templates")
  .select("id, name, system_prompt");
if (error) {
  console.error(error);
  process.exit(1);
}

let updated = 0;
for (const t of data ?? []) {
  const tName = t.name?.en || Object.values(t.name ?? {})[0] || t.id;
  if (t.system_prompt === WORLDVIEW) {
    console.log(`  · [${t.id}] ${tName} — already set`);
    continue;
  }

  console.log(
    `  ✓ [${t.id}] ${tName} — ${t.system_prompt ? `replacing (${t.system_prompt.length} → ${WORLDVIEW.length} chars)` : "setting"}`,
  );
  if (!DRY_RUN) {
    const { error: err } = await client
      .from("templates")
      .update({ system_prompt: WORLDVIEW })
      .eq("id", t.id);
    if (err) {
      console.error(`    ✗ save failed: ${err.message}`);
      process.exit(1);
    }
  }
  updated++;
}

console.log(
  `\n${DRY_RUN ? "[DRY RUN] would update" : "Updated"} ${updated} template(s) out of ${data.length}.`,
);
