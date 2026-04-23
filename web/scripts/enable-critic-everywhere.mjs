/**
 * Enable the critic pass on EVERY leaf section (except Záver, which
 * bypasses the section-agent loop and receives its own critic in the
 * route).
 *
 * The critic reads source + draft and strips any claim not traceable
 * to the source — this is the generic grounding check we need to
 * catch invention across ALL sections, not just narrative ones
 * (Celkové vyšetrenie boilerplate, EKG showing echo content, phantom
 * LA rows, etc.).
 *
 * Idempotent. Dry-run first.
 *
 * Usage:
 *   node scripts/enable-critic-everywhere.mjs --dry-run
 *   node scripts/enable-critic-everywhere.mjs
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

function norm(l) {
  return l
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[:\s]+$/g, "");
}

// Záver receives its own critic pass via runCriticAndReconcilers in
// the generate/regenerate route (it's populated by the ICD suggester,
// not the section-agent loop). Skip here to avoid double-critic.
const ZAVER_LABELS = new Set([
  "zaver",
  "assessment",
  "conclusion",
  "diagnosis",
  "diagnostic assessment",
]);

function walk(sections, report) {
  if (!Array.isArray(sections)) return false;
  let changed = false;
  for (const s of sections) {
    if (s.subsections?.length) {
      if (walk(s.subsections, report)) changed = true;
      continue;
    }
    const label = Object.values(s.labels ?? {})[0] ?? s.id;
    const labels = Object.values(s.labels ?? {}).filter(
      (l) => typeof l === "string",
    );
    const isZaver = labels.some((l) => ZAVER_LABELS.has(norm(l)));
    if (isZaver) {
      report.skippedZaver.push({ id: s.id, label });
      continue;
    }
    if (s.critic === true) {
      report.alreadyOn.push({ id: s.id, label });
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
    console.error("Missing env vars");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: templates, error } = await sb
    .from("templates")
    .select("id, name, sections");
  if (error) {
    console.error("fetch failed:", error);
    process.exit(1);
  }

  console.log(
    `[critic] fetched ${templates.length} template(s). DRY_RUN=${DRY_RUN}\n`,
  );

  let totalEnabled = 0;
  let totalAlreadyOn = 0;
  let totalSkippedZaver = 0;
  let templatesWritten = 0;

  for (const t of templates) {
    const report = { enabled: [], alreadyOn: [], skippedZaver: [] };
    const changed = walk(t.sections, report);
    const displayName = t.name?.sk || t.name?.en || t.id;
    for (const m of report.enabled) {
      console.log(`  ✏  ${displayName} → "${m.label}" (${m.id}): critic=true`);
      totalEnabled++;
    }
    totalAlreadyOn += report.alreadyOn.length;
    totalSkippedZaver += report.skippedZaver.length;
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
    `\n[critic] done: ${totalEnabled} newly enabled, ${totalAlreadyOn} already on, ${totalSkippedZaver} Záver-like (handled in route), ${templatesWritten} template(s) written${DRY_RUN ? " (DRY RUN)" : ""}.`,
  );
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
