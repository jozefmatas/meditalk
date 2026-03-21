/**
 * Seed templates into Supabase.
 * Deletes existing rows and inserts from static template files.
 *
 * Usage: npx tsx scripts/seed-templates.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { comprehensiveMedicalExam } from "../src/lib/templates/comprehensive-medical-exam";
import { basicSoap } from "../src/lib/templates/basic-soap";
import { focusedCardiologyExam } from "../src/lib/templates/focused-cardiology-exam";
import { comprehensiveCardiologyExam } from "../src/lib/templates/comprehensive-cardiology-exam";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key);

const templates = [
  { template: comprehensiveMedicalExam, sort_order: 0 },
  { template: basicSoap, sort_order: 1 },
  { template: focusedCardiologyExam, sort_order: 2 },
  { template: comprehensiveCardiologyExam, sort_order: 3 },
];

async function main() {
  // Delete all existing templates
  console.log("Deleting existing templates...");
  const { data: existing } = await supabase
    .from("templates")
    .select("id");

  if (existing && existing.length > 0) {
    const ids = existing.map((r) => r.id as string);
    const { error: delError } = await supabase
      .from("templates")
      .delete()
      .in("id", ids);

    if (delError) {
      console.error("Delete failed:", delError.message);
      process.exit(1);
    }
    console.log(`  Deleted ${ids.length} existing rows`);
  }

  // Insert seed templates
  const rows = templates.map(({ template: t, sort_order }) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    sections: t.sections,
    system_prompt: t.systemPrompt ?? null,
    style_examples: t.styleExamples ?? [],
    specialties: t.specialties ?? [],
    is_system: true,
    visible: true,
    sort_order,
  }));

  console.log(`Inserting ${rows.length} templates...`);
  const { error: insertError } = await supabase.from("templates").insert(rows);

  if (insertError) {
    console.error("Insert failed:", insertError.message);
    process.exit(1);
  }

  // Verify
  const { data } = await supabase
    .from("templates")
    .select("id, name")
    .order("sort_order");

  console.log("Seeded templates:");
  for (const t of data ?? []) {
    const name = (t.name as Record<string, string>).sk ?? t.id;
    console.log(`  - ${t.id}: ${name}`);
  }
}

main();
