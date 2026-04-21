/**
 * Quick spot-check: print the full `context` string for one section in one
 * template, so you can confirm the patch only appended and did not overwrite.
 *
 * Usage:  node scripts/inspect-section-context.mjs <templateId> <labelRegex>
 * Example: node scripts/inspect-section-context.mjs t_KZPRXwjQye '^Výška$'
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

const [, , templateId, labelPattern] = process.argv;
if (!templateId || !labelPattern) {
  console.error(
    "Usage: node scripts/inspect-section-context.mjs <templateId> <labelRegex>",
  );
  process.exit(1);
}

const client = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data, error } = await client
  .from("templates")
  .select("sections")
  .eq("id", templateId)
  .single();
if (error) {
  console.error(error);
  process.exit(1);
}

const re = new RegExp(labelPattern, "i");
function walk(section) {
  const labels = Object.values(section.labels ?? {}).filter(
    (v) => typeof v === "string",
  );
  if (labels.some((l) => re.test(l))) {
    const label = section.labels.sk ?? section.labels.en ?? "?";
    console.log(`\n=== ${label} (id=${section.id}) ===\n`);
    console.log(section.context ?? "(empty)");
    console.log(`\n=== END ${label} ===`);
  }
  for (const sub of section.subsections ?? []) walk(sub);
}
for (const s of data.sections ?? []) walk(s);
