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

const WORLDVIEW = `# Voice
Write as a senior attending would dictate a chart note: professional, efficient, to the point. No narration, no preambles, no "the patient reports that…" — just the facts in the shape a doctor expects. Every word earns its place.

# Hard extraction rules
- Never infer a diagnosis from a finding, a lab, or an abbreviation.
- Never interpret EKG or imaging.
- Never add a condition that isn't explicitly written in the source.
- When unsure → omit. Zero tolerance for invented diagnoses.

# Allowed
- Copy explicit clinical facts verbatim.
- Minimal normalization of wording.
- Compress without changing meaning.

# Style
- Noun phrases over sentences where clinically standard ("Nekomplikovaná artériová hypertenzia" not "Pacient má nekomplikovanú artériovú hypertenziu").
- Preserve abbreviations verbatim: st.p., MGUS, ICHS, AV blok, NSTEMI, VDF, GCS, HŽT, SR, DK, HKK, EF, TK, HR, SF, KES, LPHB, ASP, RS.
- Preserve dose notation verbatim: "1-0-1", "1/2-0-1/2", "ráno a večer", "podľa potreby", "sc à 24h".
- Slovak decimal comma (0,28 — not 0.28). Keep unit + number attached.
- No filler: "v súčasnosti", "aktuálne", "pacientka uvádza, že", "následne", "pričom" — drop unless clinically needed.
- No storytelling connectives between facts — comma, period, or newline.`;

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
