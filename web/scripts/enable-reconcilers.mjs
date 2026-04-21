/**
 * One-shot: configure section-level fields (reconcilers, model tier) on
 * matching sections across all templates in Supabase.
 *
 * Idempotent — a reconciler is added only if it's not already present;
 * a model is updated only if it differs from the desired value.
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

/** Known section-label sets we target. */
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

const ZAVER_LABELS = new Set([
  "zaver",
  "zavěr",
  "assessment",
  "conclusion",
  "diagnosis",
  "diagnostic assessment",
  "conclusion and recommendation",
  "zaver a odporucanie",
  "zaver a doporuceni",
  "zaver a odporucenie",
]);

/** Labels that should be rendered by Sonnet instead of Haiku. */
const SONNET_LABELS = new Set([
  // RA
  "ra",
  "fhx",
  "family history",
  "rodinna anamneza",
  // OA
  "oa",
  "pmhx",
  "past medical history",
  "osobna anamneza",
  "osobni anamneza",
  // TO / HPI
  "to",
  "hpi",
  "history of present illness",
  "anamneza sucasneho ochorenia",
  "anamneza soucasneho onemocneni",
  ...ZAVER_LABELS,
]);

const ENABLEMENTS = [
  {
    label: "drug-normalizer on medication sections",
    matches: (labels) =>
      labels.some((l) => MEDICATION_LABELS.has(normalizeLabel(l))),
    reconcilers: ["drug-normalizer"],
  },
  {
    label: "icd-validator on Záver sections",
    matches: (labels) =>
      labels.some((l) => ZAVER_LABELS.has(normalizeLabel(l))),
    reconcilers: ["icd-validator"],
  },
  {
    label: "Sonnet model on RA/OA/TO/Záver",
    matches: (labels) =>
      labels.some((l) => SONNET_LABELS.has(normalizeLabel(l))),
    model: "sonnet",
  },
];

function patchSection(section, report) {
  const labels = Object.values(section.labels ?? {}).filter(
    (v) => typeof v === "string",
  );
  for (const rule of ENABLEMENTS) {
    if (!rule.matches(labels)) continue;

    const changes = [];

    // reconcilers[]
    if (rule.reconcilers?.length) {
      const existing = Array.isArray(section.reconcilers)
        ? [...section.reconcilers]
        : [];
      for (const r of rule.reconcilers) {
        if (!existing.includes(r)) {
          existing.push(r);
          changes.push(`+reconciler:${r}`);
        }
      }
      section.reconcilers = existing;
    }

    // model
    if (rule.model && section.model !== rule.model) {
      changes.push(`model:${section.model ?? "haiku"}→${rule.model}`);
      section.model = rule.model;
    }

    if (changes.length > 0) {
      report.push({ id: section.id, labels: section.labels, changes });
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
    console.log(`  ✓ ${label}  (${r.changes.join(", ")})`);
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
