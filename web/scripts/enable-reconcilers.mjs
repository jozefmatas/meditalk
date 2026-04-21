/**
 * One-shot: enable specific reconcilers on matching sections across all
 * templates in Supabase. Idempotent — a reconciler is added to a section's
 * `reconcilers` array only if it isn't already present.
 *
 * Usage:  node scripts/enable-reconcilers.mjs [--dry-run]
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

/** Map from label regex → list of reconciler keys to ensure are attached. */
/**
 * Normalize a label for matching: lowercase, strip diacritics, strip
 * surrounding whitespace and trailing colons. "LA: " → "la".
 */
function normalizeLabel(l) {
  return l
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[:\s]+$/g, "");
}

/** Known medication-section labels across the templates in use. */
const MEDICATION_LABELS = new Set([
  "la",
  "lieky",
  "liek",
  "meds",
  "medication",
  "medications",
  "current medication",
  "current medications",
  "aktualna medikacia",
  "aktualni medikace",
  "liekova anamneza",
]);

const ENABLEMENTS = [
  {
    matches: (labels) =>
      labels.some((l) => MEDICATION_LABELS.has(normalizeLabel(l))),
    reconcilers: ["drug-normalizer"],
  },
];

function patchSection(section, report) {
  const labels = Object.values(section.labels ?? {}).filter(
    (v) => typeof v === "string",
  );
  for (const rule of ENABLEMENTS) {
    if (!rule.matches(labels)) continue;
    const existing = Array.isArray(section.reconcilers)
      ? [...section.reconcilers]
      : [];
    const added = [];
    for (const r of rule.reconcilers) {
      if (!existing.includes(r)) {
        existing.push(r);
        added.push(r);
      }
    }
    if (added.length > 0) {
      section.reconcilers = existing;
      report.push({ id: section.id, labels: section.labels, added });
    }
  }
  for (const sub of section.subsections ?? []) patchSection(sub, report);
}

const client = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: templates, error } = await client
  .from("templates")
  .select("id, name, sections");
if (error) {
  console.error(error);
  process.exit(1);
}

let totalTemplatesChanged = 0;
let totalSectionsChanged = 0;
for (const template of templates ?? []) {
  const report = [];
  for (const s of template.sections ?? []) patchSection(s, report);
  if (report.length === 0) continue;

  totalTemplatesChanged++;
  totalSectionsChanged += report.length;
  const name =
    (template.name && (template.name.en || Object.values(template.name)[0])) ??
    template.id;
  console.log(`\n[${template.id}] ${name}`);
  for (const r of report) {
    const label =
      r.labels.sk ?? r.labels.en ?? r.labels[Object.keys(r.labels)[0]];
    console.log(`  ✓ ${label}  (+reconcilers: ${r.added.join(", ")})`);
  }

  if (!DRY_RUN) {
    const { error: err } = await client
      .from("templates")
      .update({ sections: template.sections })
      .eq("id", template.id);
    if (err) {
      console.error(`    failed to save: ${err.message}`);
      process.exit(1);
    }
  }
}

console.log(
  `\n${DRY_RUN ? "[DRY RUN] would update" : "Updated"} ${totalSectionsChanged} section(s) across ${totalTemplatesChanged} template(s).`,
);
