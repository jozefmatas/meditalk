/**
 * One-shot: clear `templates.system_prompt` for any template whose stored
 * value is the old JSON-output pipeline prompt ("INSUFFICIENT CONTEXT CHECK",
 * "Return valid JSON with the following keys", etc.).
 *
 * Those prompts were written for the deleted `generateFromTemplate` monolith
 * and would actively break the section-agent pipeline if threaded through as
 * template-wide guardrails.
 *
 * Idempotent: templates with a non-stale or empty system_prompt are untouched.
 *
 * Usage:  node scripts/clear-stale-system-prompts.mjs [--dry-run]
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

// Signatures of the old JSON-output pipeline prompt — any system_prompt
// containing ALL three is treated as stale and cleared.
const STALE_SIGNATURES = [
  "INSUFFICIENT CONTEXT CHECK",
  "Return valid JSON",
  "insufficient_context",
];

function isStale(systemPrompt) {
  if (!systemPrompt || typeof systemPrompt !== "string") return false;
  return STALE_SIGNATURES.every((s) => systemPrompt.includes(s));
}

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

let clearedCount = 0;
let keptCount = 0;
for (const t of data ?? []) {
  const name = t.name?.en || Object.values(t.name ?? {})[0] || t.id;
  if (!isStale(t.system_prompt)) {
    keptCount++;
    continue;
  }
  console.log(`${DRY_RUN ? "[DRY]" : "    "} clearing [${t.id}] ${name}`);
  if (!DRY_RUN) {
    const { error: err } = await client
      .from("templates")
      .update({ system_prompt: null })
      .eq("id", t.id);
    if (err) {
      console.error(`  failed: ${err.message}`);
      process.exit(1);
    }
  }
  clearedCount++;
}

console.log(
  `\n${DRY_RUN ? "[DRY RUN] would clear" : "Cleared"} ${clearedCount} stale prompt(s). ${keptCount} left untouched.`,
);
