/**
 * Print the leaf-section render order (depth-first, template order) for
 * one template — exactly what the pipeline would use.
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

const [, , templateId] = process.argv;
if (!templateId) {
  console.error("Usage: node scripts/dump-template-leaves.mjs <templateId>");
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

function walk(section, out) {
  if (section.subsections?.length) {
    for (const s of section.subsections) walk(s, out);
  } else {
    out.push(section);
  }
}

const leaves = [];
for (const s of data.sections ?? []) walk(s, leaves);

console.log(`${leaves.length} leaf sections in render order:\n`);
leaves.forEach((s, i) => {
  const label = s.labels?.sk ?? s.labels?.en ?? s.id;
  const hasContext = s.context ? "✓" : " ";
  const model = s.model ?? "haiku";
  const reconcilers = (s.reconcilers ?? []).join(",") || "-";
  console.log(
    `  ${String(i + 1).padStart(2)}. [${hasContext}] ${label.padEnd(28)} id=${s.id.padEnd(14)} model=${model.padEnd(6)} reconcilers=${reconcilers}`,
  );
});
