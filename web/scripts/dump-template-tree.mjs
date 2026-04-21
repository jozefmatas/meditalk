/**
 * Dump the full section tree (parent + subsections) of a template so we
 * can see the hierarchy exactly.
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
const client = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const { data } = await client
  .from("templates")
  .select("sections")
  .eq("id", templateId)
  .single();

function render(section, depth = 0) {
  const label = section.labels?.sk ?? section.labels?.en ?? section.id;
  const hasCtx = section.context ? "✓" : "·";
  const model = section.model ?? "haiku";
  const pad = "  ".repeat(depth);
  console.log(
    `${pad}${hasCtx} ${label.padEnd(30 - depth * 2)} id=${section.id.padEnd(14)} model=${model}`,
  );
  for (const sub of section.subsections ?? []) render(sub, depth + 1);
}
for (const s of data.sections ?? []) render(s);
