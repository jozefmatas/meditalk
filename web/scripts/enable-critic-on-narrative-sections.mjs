/**
 * Enable the critic pass on sections where invention / omission bite
 * hardest: HPI/TO (narrative history), Záver (diagnostic assessment),
 * OA (clinical judgment on chronic conditions).
 *
 * Skips structural sections (Vitals, BMI, Výška, EKG, etc.) where a
 * second Haiku call adds noise on single-value extractions.
 *
 * Idempotent — sections already set to `critic: true` are skipped.
 * Dry-run first.
 *
 * Usage:
 *   node scripts/enable-critic-on-narrative-sections.mjs --dry-run
 *   node scripts/enable-critic-on-narrative-sections.mjs
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

function normalizeLabel(l) {
  return l
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[:\s]+$/g, "");
}

/** Labels that should have the critic pass enabled. */
const CRITIC_LABELS = new Set([
  // OA — personal medical history
  "oa",
  "osobna anamneza",
  "past medical history",
  "pmh",
  "pmhx",
  // TO — Terajšie ochorenie / HPI
  "to",
  "terajsie ochorenie",
  "prezentacia",
  "hpi",
  "history of present illness",
  "present illness",
  "ha",
  "hlavna anamneza",
  "anamneza teraz",
  // Záver — assessment / diagnostic close
  "zaver",
  "assessment",
  "conclusion",
  "diagnosis",
  "diagnostic assessment",
]);

function matchesLabelSet(section, labelSet) {
  const labels = Object.values(section?.labels ?? {});
  for (const l of labels) {
    if (typeof l !== "string") continue;
    if (labelSet.has(normalizeLabel(l))) return true;
  }
  return false;
}

function walk(sections, report) {
  if (!Array.isArray(sections)) return false;
  let changed = false;
  for (const s of sections) {
    if (s.subsections?.length) {
      if (walk(s.subsections, report)) changed = true;
      continue;
    }
    const label = Object.values(s.labels ?? {})[0] ?? s.id;
    if (!matchesLabelSet(s, CRITIC_LABELS)) continue;
    if (s.critic === true) {
      report.skipped.push({ id: s.id, label });
      continue;
    }
    report.enabled.push({ id: s.id, label });
    s.critic = true;
    changed = true;
  }
  return changed;
}

async function main() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: templates, error } = await sb
    .from("templates")
    .select("id, name, sections");
  if (error) {
    console.error("Failed to fetch templates:", error);
    process.exit(1);
  }

  console.log(
    `[critic] fetched ${templates.length} template(s). DRY_RUN=${DRY_RUN}\n`,
  );

  let totalEnabled = 0;
  let totalSkipped = 0;
  let templatesWritten = 0;

  for (const t of templates) {
    const report = { enabled: [], skipped: [] };
    const changed = walk(t.sections, report);

    const displayName =
      (t.name && (t.name.en || t.name.sk || Object.values(t.name)[0])) ?? t.id;
    if (!report.enabled.length && !report.skipped.length) {
      console.log(`- ${displayName}: no HPI / OA / Záver section matched.`);
      continue;
    }
    for (const m of report.enabled) {
      console.log(
        `  ✏  ${displayName} → "${m.label}" (${m.id}): set critic=true`,
      );
      totalEnabled++;
    }
    for (const s of report.skipped) {
      console.log(
        `  =  ${displayName} → "${s.label}" (${s.id}): critic already on. Skip.`,
      );
      totalSkipped++;
    }

    if (changed && !DRY_RUN) {
      const { error: upErr } = await sb
        .from("templates")
        .update({ sections: t.sections })
        .eq("id", t.id);
      if (upErr) {
        console.error(`  ✖  ${displayName}: update failed:`, upErr);
        continue;
      }
      templatesWritten++;
    }
  }

  console.log(
    `\n[critic] done: ${totalEnabled} enabled, ${totalSkipped} already-on, ${templatesWritten} template(s) written${DRY_RUN ? " (DRY RUN — no DB writes)" : ""}.`,
  );
}

main().catch((err) => {
  console.error("[critic] fatal:", err);
  process.exit(1);
});
