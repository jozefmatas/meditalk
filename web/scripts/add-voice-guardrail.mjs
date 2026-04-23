/**
 * Add a clinical-voice guardrail to every template's system_prompt.
 *
 * Observed failure: the EA section rendered patient-quote content in
 * FIRST person ("Pokašľávam, ale to mám stále", "Na peľ a roztoče som
 * alergická") — it copied what the patient said verbatim. Clinical
 * notes must always be 3rd person clinical voice from the physician's
 * perspective.
 *
 * Fix: add a template-wide rule forbidding 1st and 2nd person, giving
 * concrete rephrasing examples.
 *
 * Idempotent. Dry-run first.
 *
 * Usage:
 *   node scripts/add-voice-guardrail.mjs --dry-run
 *   node scripts/add-voice-guardrail.mjs
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
const MARKER = "# Clinical voice (3rd person, physician POV)";

const APPENDED_BLOCK = `

# Clinical voice (3rd person, physician POV)
Always write in 3rd person clinical voice from the physician's perspective. NEVER copy the patient's phrasing verbatim in 1st or 2nd person.

Forbidden constructions:
- 1st person singular: "mám", "cítim", "beriem", "užívam", "pokašľávam", "-m" verb endings, "moja", "ja", "som alergická", "bolí ma".
- 2nd person: "vy", "vám", "máte", imperative forms.
- Direct quotes introduced from the conversation ("pacient hovorí: …", "uviedla, že…" is fine; quoting in 1st person is not).

Rephrase into 3rd person, using the grammatical gender agreed with the patient's sex (see gender agreement section above):
- Patient says "Pokašľávam, hlavne v zime." → "Pokašľáva, hlavne v zime." / "Udáva chronický kašeľ, hlavne v zime."
- Patient says "Na peľ som alergická." → belongs in AA (not EA); "Alergia na peľ."
- Patient says "Beriem Eliquis." → "Užíva Eliquis." (or just list the drug in LA).
- Patient says "Bolí ma na hrudi." → "Udáva bolesť na hrudi." / "Bolesť na hrudi."

If unsure whether a clause is in patient voice, check for -m/-me/-am verb endings, first-person pronouns ("ja", "moja", "mi"), or gendered self-referential adjectives ("som alergická", "som dušná"). Rewrite those.`;

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
    `[voice] fetched ${templates.length} template(s). DRY_RUN=${DRY_RUN}\n`,
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
    `\n[voice] done: ${totalUpdated} updated, ${totalSkipped} skipped, ${templatesWritten} template(s) written${DRY_RUN ? " (DRY RUN — no DB writes)" : ""}.`,
  );
}

main().catch((err) => {
  console.error("[voice] fatal:", err);
  process.exit(1);
});
