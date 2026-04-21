/**
 * Dump the raw JSON of a specific section in a template, so we can see
 * every field (id, labels, context, model, reconcilers, previousContext, …).
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

const [, , templateId, sectionId] = process.argv;
if (!templateId) {
  console.error(
    "Usage: node scripts/dump-raw-section.mjs <templateId> [sectionId]",
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

function walk(section, cb) {
  cb(section);
  for (const sub of section.subsections ?? []) walk(sub, cb);
}

for (const s of data.sections ?? []) {
  walk(s, (section) => {
    if (!sectionId || section.id === sectionId) {
      const copy = { ...section };
      if (copy.context)
        copy.context = `${copy.context.length} chars: "${copy.context.slice(0, 60)}…"`;
      if (copy.previousContext)
        copy.previousContext = `${copy.previousContext.length} chars`;
      if (copy.subsections)
        copy.subsections = `${copy.subsections.length} subsections`;
      console.log(JSON.stringify(copy, null, 2));
      console.log("---");
    }
  });
}
