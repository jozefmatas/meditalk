/**
 * Print `template.system_prompt` for every template in Supabase so we can
 * see whether any old/stale prompts (from the deleted JSON-output pipeline)
 * are lingering in the DB before we start threading them into the agent.
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

for (const t of data ?? []) {
  const name = t.name?.en || Object.values(t.name ?? {})[0] || t.id;
  const sp = (t.system_prompt ?? "").toString();
  console.log(`\n=== [${t.id}] ${name} ===`);
  if (!sp.trim()) {
    console.log("(no system_prompt set)");
  } else {
    console.log(sp);
  }
}
