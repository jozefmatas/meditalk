/**
 * Append a template-wide hard rule about grounding Objective Exam
 * content in explicit sources only — never from voice examples,
 * training data, or "normal exam" boilerplate.
 *
 * Observed failure: on sources with no dictated physical exam (e.g.
 * Majdák's pre-procedure admission — all conversation, no exam
 * dictation; no "Actual" file uploaded), the model fills Celkové
 * vyšetrenie / Krvný tlak / etc. with plausible "normal findings"
 * boilerplate borrowed from few-shot voice examples. This is
 * invention and clinically dangerous.
 *
 * Fix: a LOUD cross-section rule stating that Objective Exam content
 * must come from (1) transcript, (2) doctor notes, or (3) a file
 * uploaded as "Actual" (= no distillation directive). Nothing else
 * counts. If none exists, the section stays empty.
 *
 * Idempotent. Dry-run first.
 *
 * Usage:
 *   node scripts/add-objective-grounding-rule.mjs --dry-run
 *   node scripts/add-objective-grounding-rule.mjs
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
const MARKER = "# Objective exam grounding (HARD RULE)";

const APPENDED_BLOCK = `

# Objective exam grounding (HARD RULE)
Any content rendered into an Objective Exam section — Celkové vyšetrenie / Celkový stav / Fyzikálne vyšetrenie, Krvný tlak, Pulz, Výška, Hmotnosť, BMI, EKG, and any other physical-findings subsection — MUST originate from one of exactly these three sources for THIS encounter:

1. The transcript — the doctor audibly dictates a finding ("dýchanie čisté vezikulárne bilat.", "ozvy ohraničené", "brucho mäkké, priehmatné, nebolestivé", "TK 140/80").
2. The doctor notes — the doctor typed a finding.
3. An uploaded file the doctor marked as "Actual" (no distillation directive attached) — the pipeline treats such a file as today's data and may pull findings from it.

If NONE of (1)(2)(3) contains an explicit finding for a given exam section, that section MUST be empty. Zero characters. No exceptions.

## FORBIDDEN FALLBACKS — invention traps
Do NOT generate "normal exam" boilerplate to fill an empty slot. These sentences LOOK like doctor findings but they come from your training data or from voice examples of OTHER patients — using them here is INVENTION and can harm the patient:
- "Pacient pri vedomí, orientovaný"
- "Habitus štíhly" / "Habitus obézny"
- "Dýchanie bez ráz" / "Dýchanie vezikulárne bilat."
- "Srdce pravidelný rytmus" / "Srdečné tony pravidelné, bez patologických šelestov"
- "Abdomen mäkký, bez bolestivosti" / "Brušná stena mäkká, palpačne bez bolestivosti"
- "Dolné končatiny bez edémov" / "Neurologické vyšetrenie bez ložiskových nálezov"

If you find yourself about to write one of these — STOP. Check: is it in the transcript, doctor notes, or an Actual-marked file for THIS patient right now? If not, leave the section empty.

## Past files (distillation directive set)
A file uploaded as "Past" — i.e. with a distillation directive typed in the context dialog ("Vezmi iba echokg a záver", "iba lieky", etc.) — has already been pre-filtered by the pipeline to the passages the directive matched. You will see ONLY those passages. Treat them as reference content for the sections they cover; they do NOT authorise you to fabricate Objective Exam findings in sections the directive didn't cover.`;

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
    console.error("fetch failed:", error);
    process.exit(1);
  }

  console.log(
    `[grounding] fetched ${templates.length} template(s). DRY_RUN=${DRY_RUN}\n`,
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
    `\n[grounding] done: ${totalUpdated} updated, ${totalSkipped} skipped, ${templatesWritten} template(s) written${DRY_RUN ? " (DRY RUN — no DB writes)" : ""}.`,
  );
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
