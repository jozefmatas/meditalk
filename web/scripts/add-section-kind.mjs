/**
 * One-off migration: backfill `kind` on every TemplateSection.
 *
 * The pipeline dispatches per-section behaviour (voice-example
 * suppression, digit-grounding, critic model tier, render-loop skip)
 * on `section.kind`. Until this runs, the pipeline falls back to
 * label-matching and logs a warning per fallback hit. This script
 * reads every template's section tree, derives `kind` using the same
 * legacy label rules, and writes it back.
 *
 * Idempotent — sections that already have `kind` are skipped.
 *
 * Usage:
 *   node scripts/add-section-kind.mjs --dry-run
 *   node scripts/add-section-kind.mjs
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

// Mirror of pipeline.ts's legacy label sets + resolveKind logic.
// Same normalization: NFKD + strip diacritics + lowercase + trim.
const ZAVER_LABELS = new Set([
  "zaver",
  "assessment",
  "conclusion",
  "diagnosis",
  "diagnostic assessment",
]);
const STRUCTURAL_VITAL_LABELS = new Set([
  "vyska",
  "hmotnost",
  "bmi",
  "krvny tlak",
  "tk",
  "pulz",
  "sf",
  "ekg",
  "ecg",
  "height",
  "weight",
  "blood pressure",
  "heart rate",
]);
const EXAM_NARRATIVE_LABELS = new Set([
  "celkove vysetrenie",
  "celkovy stav",
  "celkovy nalez",
  "fyzikalne vysetrenie",
  "fyzikalni vysetreni",
  "objektivne vysetrenie",
  "objektivni vysetreni",
  "general examination",
  "general condition",
  "physical examination",
  "physical exam",
]);
const LA_LABELS = new Set([
  "la",
  "liekova anamneza",
  "lekova anamneza",
  "medications",
  "current medications",
  "medication list",
  "home medications",
  "meds",
]);

// HPI / TO-style section labels — these get "history-narrative".
// Not in pipeline.ts today (it treats them as "default"), but the new
// taxonomy names them explicitly so future admins can set them.
const HPI_LABELS = new Set([
  "to",
  "terajsie ochorenie",
  "anamneza terajsieho ochorenia",
  "hpi",
  "history of present illness",
  "present illness",
  "current illness",
  "nynejsi onemocneni",
  "anamneza nynejsiho onemocneni",
]);

function normalizeLabel(s) {
  return (s || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

function deriveKind(section) {
  const labels = Object.values(section.labels || {});
  const hit = (set) =>
    labels.some((l) => typeof l === "string" && set.has(normalizeLabel(l)));

  if (hit(ZAVER_LABELS)) return "conclusion";
  if (hit(STRUCTURAL_VITAL_LABELS)) return "vital-numeric";
  if (hit(EXAM_NARRATIVE_LABELS)) return "exam-narrative";
  if (hit(LA_LABELS)) return "medication-list";
  if (hit(HPI_LABELS)) return "history-narrative";
  return "default";
}

// Walk the sections tree, return {updatedCount, changedSections}.
function annotateKinds(sections) {
  let updated = 0;
  const changed = [];
  const walk = (arr) => {
    for (const s of arr) {
      if (s.subsections?.length) walk(s.subsections);
      if (!s.kind) {
        const kind = deriveKind(s);
        s.kind = kind;
        updated++;
        const label =
          s.labels?.sk || s.labels?.en || s.labels?.cs || "(no label)";
        changed.push({ id: s.id, label, kind });
      }
    }
  };
  walk(sections);
  return { updated, changed };
}

async function main() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: templates, error } = await sb
    .from("templates")
    .select("id, name, sections");
  if (error) {
    console.error("Fetch failed:", error.message);
    process.exit(1);
  }

  let totalUpdated = 0;
  let templatesTouched = 0;

  for (const t of templates ?? []) {
    const sections = t.sections;
    if (!Array.isArray(sections)) continue;

    // Clone so we can inspect diffs cleanly.
    const copy = JSON.parse(JSON.stringify(sections));
    const { updated, changed } = annotateKinds(copy);
    if (updated === 0) continue;

    templatesTouched++;
    totalUpdated += updated;
    const name = t.name?.sk || t.name?.en || t.id;

    console.log(`\n▸ ${name} (${t.id})  — ${updated} section(s) updated`);
    for (const c of changed) {
      console.log(`    ${c.id.padEnd(15)} ${c.label.padEnd(32)} → ${c.kind}`);
    }

    if (!DRY_RUN) {
      const { error: upErr } = await sb
        .from("templates")
        .update({ sections: copy })
        .eq("id", t.id);
      if (upErr) {
        console.error(`  ! update failed for ${t.id}:`, upErr.message);
      }
    }
  }

  console.log(
    `\n${DRY_RUN ? "[DRY RUN] Would update" : "Updated"} ${totalUpdated} section(s) across ${templatesTouched} template(s).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
