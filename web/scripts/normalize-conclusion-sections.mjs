/**
 * One-shot: update conclusion (Záver) sections across all templates.
 *
 * 1. Sets `section.context` to the prose-oriented contract from the
 *    pipeline-precision-upgrade plan.
 * 2. Removes `icd-validator` from reconcilers (no ICD codes in prose).
 * 3. Clears any per-section `model` override — KIND_POLICY now drives
 *    the render model (Sonnet for conclusion).
 *
 * Idempotent — safe to re-run. Skips sections already matching.
 *
 * Usage:  node scripts/normalize-conclusion-sections.mjs [--dry-run]
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

// ── Label matching ──────────────────────────────────────────────

function normalizeLabel(l) {
  return l
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[:\s]+$/g, "");
}

const CONCLUSION_LABELS = new Set([
  "zaver",
  "zaver",
  "assessment",
  "conclusion",
  "diagnosis",
  "diagnostic assessment",
  "conclusion and recommendation",
  "zaver a odporucanie",
  "zaver a doporuceni",
  "zaver a odporucenie",
]);

function isConclusionSection(section) {
  // Prefer explicit kind
  if (section.kind === "conclusion") return true;
  // Fall back to label matching
  const labels = Object.values(section.labels ?? {}).filter(
    (v) => typeof v === "string",
  );
  return labels.some((l) => CONCLUSION_LABELS.has(normalizeLabel(l)));
}

// ── New contract ────────────────────────────────────────────────

const CONCLUSION_CONTRACT = `Záver — klinický záver vyšetrenia. Každú diagnózu uveď na samostatnom riadku.
PORADIE: (1) Aktuálna/akútna diagnóza tohto vyšetrenia. (2) Komorbidity relevantné pre špecializáciu.
(3) Ostatné diagnózy. Použi klinické skratky (DM 2. typu, AH III. st., DLP).
NIKDY neuvádzaj ICD kódy — kódy patria výhradne do panelu diagnóz.
Ak nie sú žiadne diagnózy v zdroji, vráť prázdny reťazec.`;

// ── Patch logic ─────────────────────────────────────────────────

function patchSection(section, report) {
  if (!isConclusionSection(section)) {
    for (const sub of section.subsections ?? []) patchSection(sub, report);
    return;
  }

  const changes = [];

  // 1. Update context to prose contract
  if (section.context !== CONCLUSION_CONTRACT) {
    const old = (section.context ?? "(none)").slice(0, 60);
    section.context = CONCLUSION_CONTRACT;
    changes.push(`context: "${old}…" → prose contract`);
  }

  // 2. Remove icd-validator reconciler
  if (Array.isArray(section.reconcilers)) {
    const idx = section.reconcilers.indexOf("icd-validator");
    if (idx !== -1) {
      section.reconcilers.splice(idx, 1);
      changes.push("-reconciler:icd-validator");
    }
    // Clean up empty array
    if (section.reconcilers.length === 0) {
      delete section.reconcilers;
    }
  }

  // 3. Clear model override — KIND_POLICY.conclusion.renderModel = "sonnet"
  if (section.model) {
    changes.push(`model: ${section.model} → (removed, KIND_POLICY drives)`);
    delete section.model;
  }

  if (changes.length > 0) {
    report.push({ id: section.id, labels: section.labels, changes });
  }

  for (const sub of section.subsections ?? []) patchSection(sub, report);
}

// ── Main ────────────────────────────────────────────────────────

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
  `\n${DRY_RUN ? "[DRY RUN] would update" : "Updated"} ${totalSectionsChanged} conclusion section(s) across ${totalTemplatesChanged} template(s).`,
);
