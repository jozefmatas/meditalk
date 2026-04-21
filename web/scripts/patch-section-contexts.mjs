/**
 * One-shot data patch: append contract refinements to every matching section
 * across all templates in Supabase.
 *
 * Idempotent — each patch carries a unique `<!-- mt-patch:<tag> -->` marker so
 * re-running the script never duplicates content.
 *
 * Usage:  node scripts/patch-section-contexts.mjs [--dry-run]
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "..", ".env.local");

// ── Load env from .env.local (no dotenv dep) ──────────────────────────────
const envRaw = readFileSync(ENV_PATH, "utf-8");
const env = Object.fromEntries(
  envRaw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      const k = l.substring(0, i).trim();
      let v = l.substring(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      return [k, v];
    }),
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");

// ── Patch set ─────────────────────────────────────────────────────────────
/**
 * Each patch: a label regex (matched against section.labels.sk / cs / en) and
 * a tagged block of additional rules to append.  The `tag` makes the patch
 * idempotent — the script won't re-append a block already present.
 */
const PATCHES = [
  {
    tag: "ra-condition-combining-v1",
    labelMatch: /^(ra|rodinn[áa]\s+anamn[éze]|family\s+history)$/i,
    block: `If the source is ambiguous between two conditions (e.g. "heart attack" vs "stroke"), preserve the original wording verbatim — NEVER combine them into a compound term like "infarkt mozgovej mŕtvice", which is a clinical contradiction. When unsure which condition was meant, quote the speaker's exact words.`,
  },
  {
    tag: "ra-no-compound-fusion-v2",
    labelMatch: /^(ra|rodinn[áa]\s+anamn[éze]|family\s+history)$/i,
    block: `HARD RULE — no compound fusion diagnoses.

If the source mentions two conditions near each other (e.g. "infarkt" and "mŕtvica" in the same sentence), output them as SEPARATE items OR quote the speaker's exact phrasing verbatim. NEVER fuse them.

FORBIDDEN OUTPUTS — these fused terms do NOT exist in medicine. You MUST NOT write any of them:
- "infarkt mozgovej mŕtvice"
- "infarkt mozgovú mŕtvicu"
- "mozgový infarkt mŕtvica"
- "stroke heart attack"
- "cerebral infarct stroke"
- any other concatenation of two distinct cardiovascular / neurovascular diagnoses

Correct alternatives when source is ambiguous:
- Write separate facts: "Otec zomrel na infarkt. Otec mal aj mozgovú mŕtvicu."
- Or quote literally: "Otec zomrel, v transcriptoch sa uvádza 'infarkt' aj 'mozgová mŕtvica'."
- Or pick the most likely single diagnosis based on the surrounding context and write ONLY that one.`,
  },
  {
    tag: "ab-sentence-quality-v1",
    labelMatch: /^(ab|ab[úu]zy|habits|substance\s+use)$/i,
    block: `Write full natural Slovak/Czech/English sentences. No parenthetical fragments like "(cigáret denne)", no truncated clauses like "Fajčí dlho.", no hanging numerals. Each fact must be a complete grammatical sentence — "Pacient fajčí 15 cigariet denne." not "Pacient fajčí pätnásť (cigáret denne)."`,
  },
  {
    tag: "sa-occupation-strict-v1",
    labelMatch: /^(sa|soci[aá]lna\s+anamn[éze]|social\s+history)$/i,
    block: `STRICT EXCLUSION: occupation, job title, workplace, employer, years of employment, and employment status (retired / working / student) belong EXCLUSIVELY to PA. If the patient mentions their job while describing their social life, SKIP those words entirely — PA will pick them up. Your job here is marital status, living situation, dependents, and social support ONLY.`,
  },
  {
    tag: "ea-preserve-wording-v1",
    labelMatch:
      /^(ea|epidem|epidemiologick[áa]\s+anamn[éze]|epidemiological\s+history)$/i,
    block: `Preserve the speaker's exact wording for epidemiological exposures (travel, tick exposure, infectious contacts, vaccinations). If the source contains an ambiguous or unclear term, quote it verbatim rather than substituting a similar-sounding word. If nothing about travel / tick bites / infectious contacts / vaccinations is mentioned, return an empty string.`,
  },
  {
    tag: "ea-concrete-negatives-v3",
    labelMatch:
      /^(ea|epidem|epidemiologick[áa]\s+anamn[éze]|epidemiological\s+history)$/i,
    block: `EA overflow examples — these have actually leaked into EA in past generations. Do NOT let them leak again. For each trap below, the CORRECT action is noted:

- "pokašľáva" / chronic cough / coughing seasonally → TO (if current) or OA (if chronic). NEVER EA.
- "peľová alergia" / pollen allergy / pollen-related symptoms → AA. NEVER EA. Pollen is an allergen, not an infectious exposure.
- "roztoče" / dust mites → AA. NEVER EA.
- "žije s manželom / manželkou" / marital / cohabitation → SA. NEVER EA.
- "bol fajčiar" / smoking history → Ab. NEVER EA.
- "rodičia / súrodenci / prarodičia" / family diseases → RA. NEVER EA.
- "úraz", "hospitalizácia", "operácia" / past injuries or surgeries → OA. NEVER EA.
- "bolesť hrudníka" / presenting symptoms of this encounter → TO. NEVER EA.

EA belongs to ONLY these four things, all of which must be EXPLICITLY mentioned in the source: foreign travel, tick / insect exposure, sick contacts with infectious disease, vaccination history. If none of those four are explicitly mentioned, the section MUST be zero characters — nothing more, nothing less.`,
  },
  {
    tag: "ea-strict-scope-v2",
    labelMatch:
      /^(ea|epidem|epidemiologick[áa]\s+anamn[éze]|epidemiological\s+history)$/i,
    block: `EA — EPIDEMIOLOGICAL HISTORY ONLY. Zero tolerance for overflow.

ALLOWED content (include ONLY these four categories):
1. Travel — recent trips, exposure to endemic areas.
2. Tick / insect bites or exposures.
3. Infectious contacts — sick contacts, COVID / TB / other infectious exposures.
4. Vaccinations — flu, COVID, tetanus, travel vaccines.

FORBIDDEN — if the source contains any of the following, SKIP it. Do NOT include it here. Another section owns each of these:
- Present illness / current symptoms / today's complaint → goes to TO (HPI).
- Past surgeries, chronic conditions, prior injuries → goes to OA.
- Family diseases (parents / siblings / grandparents) → goes to RA.
- Smoking / alcohol / drugs → goes to Ab.
- Marital status / living situation / caregivers → goes to SA.
- Job / workplace / employment history → goes to PA.
- Allergies → goes to AA.
- Medications → goes to LA.
- Vital signs / physical exam findings → goes to Objektívne vyšetrenie.
- Diagnoses / differentials → goes to Záver.
- Treatment / procedures / follow-up → goes to Postup a plán.

SELF-CHECK before writing anything:
  Did the source explicitly mention travel, tick/insect exposure, infectious contacts, or vaccinations?
  - NO  → output ZERO characters. Empty response. Nothing.
  - YES → include ONLY that content, verbatim from the source.

Never improvise to "fill" this section when no epidemiological content exists.`,
  },
  {
    tag: "vyska-empty-return-v1",
    labelMatch: /^(v[ýy]ska|height)$/i,
    block: `EMPTY-RETURN RULE (overrides any other wording above): If the source does NOT explicitly state the patient's height in centimetres, return an empty string. Do NOT write "nie je uvedená", "V surových zdrojoch nie je uvedená výška", "not available", "N/A", or any other explanatory prose. Output format when a height IS stated: just the number + "cm" (e.g. "175 cm").`,
  },
  {
    tag: "hmotnost-empty-return-v1",
    labelMatch: /^(hmotnos[tť]|weight)$/i,
    block: `EMPTY-RETURN RULE (overrides any other wording above): If the source does NOT explicitly state the patient's weight in kilograms, return an empty string. Do NOT write "nie je uvedená", "V surových zdrojoch nie je uvedená hmotnosť", "not available", "N/A", or any other explanatory prose. Output format when a weight IS stated: just the number + "kg" (e.g. "78 kg").`,
  },
  {
    tag: "bmi-empty-return-v1",
    labelMatch: /^bmi$/i,
    block: `EMPTY-RETURN RULE (overrides any other wording above): Only compute BMI when BOTH height and weight are explicitly stated in the source. If either is missing, return an empty string — do NOT explain why BMI can't be calculated, do NOT write "nie je možné vypočítať", do NOT restate what's missing.`,
  },
];

const SEPARATOR = "\n\n---\n\n";
const markerFor = (tag) => `<!-- mt-patch:${tag} -->`;

/** Return the new context string, or null when no change is needed. */
function applyPatches(existingContext, labels) {
  const labelValues = Object.values(labels ?? {}).filter(
    (v) => typeof v === "string",
  );
  let next = existingContext ?? "";
  const appliedTags = [];
  for (const patch of PATCHES) {
    const matches = labelValues.some((l) => patch.labelMatch.test(l.trim()));
    if (!matches) continue;
    const marker = markerFor(patch.tag);
    if (next.includes(marker)) continue;
    const addition = `${SEPARATOR}${marker}\n${patch.block}`;
    next = next ? `${next}${addition}` : addition.trimStart();
    appliedTags.push(patch.tag);
  }
  if (appliedTags.length === 0) return { changed: false };
  return { changed: true, next, appliedTags };
}

/** Walk `section.subsections` recursively, applying patches in place. */
function walk(section, perSectionReport) {
  const result = applyPatches(section.context, section.labels);
  if (result.changed) {
    section.context = result.next;
    perSectionReport.push({
      id: section.id,
      labels: section.labels,
      tags: result.appliedTags,
    });
  }
  if (Array.isArray(section.subsections)) {
    for (const sub of section.subsections) walk(sub, perSectionReport);
  }
}

// ── Run ───────────────────────────────────────────────────────────────────
const client = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const { data: templates, error: fetchErr } = await client
  .from("templates")
  .select("id, name, sections");
if (fetchErr) {
  console.error("Failed to fetch templates:", fetchErr);
  process.exit(1);
}

console.log(`Loaded ${templates.length} templates from Supabase.`);
if (DRY_RUN) console.log("(dry run — no writes)\n");

let totalTemplatesChanged = 0;
let totalSectionsChanged = 0;

for (const template of templates) {
  const report = [];
  for (const section of template.sections ?? []) walk(section, report);
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
    console.log(`  ✓ ${label}  (patches: ${r.tags.join(", ")})`);
  }

  if (!DRY_RUN) {
    const { error: updateErr } = await client
      .from("templates")
      .update({ sections: template.sections })
      .eq("id", template.id);
    if (updateErr) {
      console.error(`    ✗ failed to save: ${updateErr.message}`);
      process.exit(1);
    }
  }
}

console.log(
  `\n${DRY_RUN ? "[DRY RUN] would patch" : "Patched"} ${totalSectionsChanged} section(s) across ${totalTemplatesChanged} template(s).`,
);
