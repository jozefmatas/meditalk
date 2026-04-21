/**
 * Dump every leaf-section label across every template, so we can see what
 * labels are actually in use before writing label-matching regexes.
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
  .select("id, name, sections");
if (error) {
  console.error(error);
  process.exit(1);
}

function walk(section, out) {
  if (section.subsections?.length) {
    for (const s of section.subsections) walk(s, out);
  } else {
    out.push(section.labels ?? {});
  }
}

for (const t of data ?? []) {
  const name = t.name?.en || Object.values(t.name ?? {})[0] || t.id;
  const labels = [];
  for (const s of t.sections ?? []) walk(s, labels);
  console.log(`\n[${t.id}] ${name}`);
  for (const l of labels) {
    const parts = Object.entries(l)
      .map(([k, v]) => `${k}:"${v}"`)
      .join(" | ");
    console.log(`  ${parts}`);
  }
}
