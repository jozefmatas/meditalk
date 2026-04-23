/**
 * Strip misleading "denial" examples from section contracts.
 *
 * Some section contracts (EA, AA, Ab) list phrases like "infekčné
 * ochorenie neguje" / "alkohol príležitostne" as examples of valid
 * output. Haiku mimics these phrases verbatim even when the source
 * never discussed the substance, producing phantom denials.
 *
 * The "silence ≠ denial" rule in the critic prompt catches most
 * leaks, but it's safer to stop teaching the wrong thing in the
 * contract itself. This migration deletes the parenthetical
 * "(or explicitly denied … — 'infekčné ochorenie neguje')" clause
 * from EA contracts across all templates. Idempotent.
 *
 * Usage:
 *   node scripts/strip-contract-denial-examples.mjs --dry-run
 *   node scripts/strip-contract-denial-examples.mjs
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

// Patterns in section contracts that teach Haiku to emit a specific
// denial phrase. Each rule replaces the left pattern with the right
// replacement (usually stripping the "or explicitly denied ..." bit).
const REPLACEMENTS = [
  {
    // EA contract: "(or explicitly denied in an infectious context — 'infekčné ochorenie neguje')"
    from: /\s*\(or\s+explicitly\s+denied\s+in\s+an\s+infectious\s+context[^)]*\)/gi,
    to: "",
    tag: "EA denial example",
  },
  {
    // "Only ... confirmed (or explicitly denied — 'X neguje')." — generic form
    from: /\s*\(or\s+explicitly\s+denied[^)]*"[^"]*neguje"[^)]*\)/gi,
    to: "",
    tag: "generic explicit-denial example",
  },
];

function applyReplacements(ctx) {
  let out = ctx;
  const hits = [];
  for (const rule of REPLACEMENTS) {
    if (rule.from.test(out)) {
      out = out.replace(rule.from, rule.to);
      hits.push(rule.tag);
    }
  }
  return { out, hits };
}

function walk(sections, report) {
  if (!Array.isArray(sections)) return false;
  let changed = false;
  for (const s of sections) {
    if (s.subsections?.length) {
      if (walk(s.subsections, report)) changed = true;
      continue;
    }
    if (!s.context) continue;
    const { out, hits } = applyReplacements(s.context);
    if (out !== s.context) {
      const label = Object.values(s.labels ?? {})[0] ?? s.id;
      report.updated.push({ id: s.id, label, hits });
      s.context = out;
      changed = true;
    }
  }
  return changed;
}

async function main() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing env");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data: templates, error } = await sb
    .from("templates")
    .select("id, name, sections");
  if (error) {
    console.error(error);
    process.exit(1);
  }
  console.log(
    `[strip-denial] fetched ${templates.length} template(s). DRY_RUN=${DRY_RUN}\n`,
  );
  let totalUpdated = 0;
  let templatesWritten = 0;
  for (const t of templates) {
    const report = { updated: [] };
    const changed = walk(t.sections, report);
    const displayName = t.name?.sk || t.name?.en || t.id;
    for (const m of report.updated) {
      console.log(
        `  ✏  ${displayName} → "${m.label}" (${m.id}): removed ${m.hits.join(", ")}`,
      );
      totalUpdated++;
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
    `\n[strip-denial] done: ${totalUpdated} updated, ${templatesWritten} template(s) written${DRY_RUN ? " (DRY RUN)" : ""}.`,
  );
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
