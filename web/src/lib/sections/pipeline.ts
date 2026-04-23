/**
 * Section pipeline — the ONLY orchestrator for note generation.
 *
 * Per-section flow:
 *   1. RENDER — section-agent (Haiku) reads raw source, uses
 *      `section.context` as its prose contract. Draft streams to the
 *      UI as soon as it finishes.
 *   2. CRITIC (opt-in) — when `section.critic` is true, a second Haiku
 *      call audits the draft against the raw source: removes invention,
 *      adds missed facts, preserves the draft's voice. Runs in parallel
 *      with the next section's render. Emits the corrected content via
 *      `onSection` again — the UI replaces by id.
 *   3. RECONCILERS — deterministic post-render helpers (drug-normalizer,
 *      icd-validator) run after the critic (or after the draft, when
 *      the critic is disabled).
 *
 * Záver is NOT rendered in this loop — the generate/regenerate route
 * pipes Záver from the ICD suggester through `runCriticAndReconcilers`
 * below so it gets the same treatment.
 */
import type { Template, TemplateSection } from "../templates/types";
import type { SupportedLanguage } from "../types";
import {
  renderSection,
  isAbsenceDescription,
  type Language,
  type RawSource,
  type RenderedSection,
  type SectionConfig,
  type UsageContext,
} from "./section-agent";
import { buildSectionExamplesMap } from "../templates/reference-notes";
import { normalizeLabel } from "../parse-note-sections";
import { criticPass } from "./critic";
import { RECONCILERS } from "./reconcilers";
import { logger } from "@/lib/logger";

const ZAVER_LABELS = new Set([
  "zaver",
  "assessment",
  "conclusion",
  "diagnosis",
  "diagnostic assessment",
]);

function isZaverSection(section: TemplateSection): boolean {
  return Object.values(section.labels ?? {}).some(
    (l) => typeof l === "string" && ZAVER_LABELS.has(normalizeLabel(l)),
  );
}

/**
 * Structural / exam-findings sections where voice examples actively
 * hurt (the "example" IS a concrete finding — vitals number or a
 * normal-exam boilerplate sentence — which Haiku mimics even when the
 * current source has no data). For these we skip the few-shot voice
 * examples entirely; the contract alone governs what gets rendered.
 *
 * For the numeric subset (Výška/Hmotnosť/BMI/Krvný tlak/Pulz/EKG) the
 * grounding check additionally strips content whose numbers aren't
 * found verbatim in the source.
 */
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

/**
 * Narrative exam sections that suffer from example-driven "normal
 * findings" boilerplate — Celkové vyšetrenie / Celkový stav /
 * Fyzikálne vyšetrenie. Skip voice examples; the hardened contract
 * requires explicit source findings or empty output.
 */
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

function isStructuralVitalLabel(title: string): boolean {
  return STRUCTURAL_VITAL_LABELS.has(normalizeLabel(title));
}

function isExamNarrativeLabel(title: string): boolean {
  return EXAM_NARRATIVE_LABELS.has(normalizeLabel(title));
}

/**
 * Slovak number-word forms for 0–220 (covers all clinically plausible
 * vital values: HR 30–200, weight 30–200 kg, height 100–220 cm, BMI
 * 10–50). Used to verify that a digit in the draft is backed by EITHER
 * a digit in the source OR its spoken Slovak form (the transcript is
 * speech, so doctors frequently say "sto tridsaťpäť" instead of 135).
 */
const SK_UNITS: Record<number, string> = {
  0: "nula",
  1: "jeden",
  2: "dva",
  3: "tri",
  4: "štyri",
  5: "päť",
  6: "šesť",
  7: "sedem",
  8: "osem",
  9: "deväť",
  10: "desať",
  11: "jedenásť",
  12: "dvanásť",
  13: "trinásť",
  14: "štrnásť",
  15: "pätnásť",
  16: "šestnásť",
  17: "sedemnásť",
  18: "osemnásť",
  19: "devätnásť",
};
const SK_TENS: Record<number, string> = {
  20: "dvadsať",
  30: "tridsať",
  40: "štyridsať",
  50: "päťdesiat",
  60: "šesťdesiat",
  70: "sedemdesiat",
  80: "osemdesiat",
  90: "deväťdesiat",
};
const SK_HUNDREDS: Record<number, string> = {
  100: "sto",
  200: "dvesto",
};
function toSlovakNumberForms(n: number): string[] {
  if (n < 0 || n > 999) return [];
  const forms = new Set<string>();
  const add = (s: string) => {
    const trimmed = s.trim();
    if (trimmed) forms.add(trimmed);
  };
  if (n < 20) {
    const w = SK_UNITS[n];
    if (w) add(w);
    return [...forms];
  }
  if (n < 100) {
    const tens = Math.floor(n / 10) * 10;
    const units = n % 10;
    const t = SK_TENS[tens];
    if (!t) return [];
    if (units === 0) {
      add(t);
    } else {
      add(`${t}${SK_UNITS[units]}`); // "tridsaťpäť"
      add(`${t} ${SK_UNITS[units]}`); // "tridsať päť"
    }
    return [...forms];
  }
  const hundreds = Math.floor(n / 100) * 100;
  const rest = n % 100;
  const h = SK_HUNDREDS[hundreds];
  if (!h) return [];
  if (rest === 0) {
    add(h);
  } else {
    for (const sub of toSlovakNumberForms(rest)) {
      add(`${h}${sub}`); // "stotridsaťpäť"
      add(`${h} ${sub}`); // "sto tridsaťpäť"
      add(sub); // bare rest, in case speaker drops "sto"
    }
  }
  return [...forms];
}

/**
 * Fold text: lowercase + strip diacritics. Slovak speech / clinical
 * notes frequently omit háčky and dĺžne; compare in folded space so
 * "pätnásť" and "patnast" both match.
 */
function foldForGrounding(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Check every number in the drafted value against the raw source. If a
 * number isn't backed by source (either as a digit string OR as its
 * Slovak number-word form), the model invented it — clear the whole
 * draft.
 *
 * Normalises decimal separators (model may emit 27.9 while source has
 * 27,9). Single-digit numbers are considered trivially grounded (they
 * appear inside other words too often to strip on that basis alone).
 */
function stripUngroundedVitalValue(content: string, source: RawSource): string {
  const draft = content.trim();
  if (!draft) return content;

  const rawBlob = [
    source.transcript ?? "",
    source.doctorNotes ?? "",
    ...(source.files ?? []).map((f) => f.text ?? ""),
  ]
    .join("\n")
    .replace(/,/g, "."); // normalise decimal separator
  const digitBlob = rawBlob;
  const wordBlob = foldForGrounding(rawBlob);

  // Pull every number out of the draft — "27,9", "80", "170.5", etc.
  const numberRe = /\d+(?:[.,]\d+)?/g;
  const numbers = draft.match(numberRe) ?? [];
  if (numbers.length === 0) return content;

  for (const n of numbers) {
    const normalised = n.replace(/,/g, ".");
    if (digitBlob.includes(normalised)) continue;

    // Single digits 0–9 are too common inside other words (V1, V2, II,
    // stp) to strip on "not literally in source" basis — skip them.
    const asInt = Number(normalised);
    if (Number.isInteger(asInt) && asInt >= 0 && asInt < 10) continue;

    // Decimals (e.g. 27.9) aren't worth enumerating Slovak word forms
    // for — require a digit match. If the digit wasn't found, strip.
    if (normalised.includes(".")) return "";

    // Integer: check Slovak number-word forms (0–999).
    if (!Number.isInteger(asInt) || asInt > 999) return "";
    const forms = toSlovakNumberForms(asInt).map((f) => foldForGrounding(f));
    const grounded = forms.some((f) => f && wordBlob.includes(f));
    if (!grounded) return "";
  }
  return content;
}

/**
 * Boilerplate markers a narrative exam section should never emit
 * unless the exact phrase appears in the source. These are canonical
 * "normal findings" sentences Haiku tends to fabricate from voice
 * examples when no real exam was dictated.
 */
const EXAM_BOILERPLATE_PATTERNS: RegExp[] = [
  /pri\s+vedom[ií]/i,
  /habitus\s+(st[ií]hly|obezny|normaln|prim)/i,
  /dychanie\s+(bez\s+raz|vezikularne|ciste)/i,
  /srdce\s+pravideln|srdecn[eé]\s+tony\s+pravideln/i,
  /abdomen\s+(mäkk|prihmat|bez\s+bolest)|bru[sš]n[aá]\s+stena\s+m[äa]kk/i,
  /dolne\s+koncatiny\s+bez\s+edem/i,
  /neurologick[eé]\s+(nalez|vysetren)\s+(v\s+norme|bez\s+lozisk|bez\s+patol)/i,
  /kozn[yý]\s+kryt\s+bez\s+ikter|koza\s+bez\s+ikter/i,
  /bez\s+sumov/i,
];

/**
 * Fold text: lowercase + strip diacritics. Slovak clinical text
 * sometimes omits diacritics; compare in the folded space.
 */
function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * If the narrative exam content is dominated by boilerplate sentences
 * that aren't grounded in the source, force empty.
 *
 * A clause is considered GROUNDED when a 25-char substring drawn from
 * it exists in the folded source — loose enough for rephrasing but
 * tight enough that shared common words ("pacient", "bez") don't
 * trivially pass. For short drafts (≤2 clauses) we're stricter: ANY
 * boilerplate-matching clause that can't be substring-matched in
 * source triggers a full strip — those are the "Pacient pri vedomí,
 * orientovaný." residues that the permissive gate used to miss.
 */
function stripBoilerplateExam(content: string, source: RawSource): string {
  const draft = content.trim();
  if (!draft) return content;

  const sourceBlob = fold(
    [
      source.transcript ?? "",
      source.doctorNotes ?? "",
      ...(source.files ?? []).map((f) => f.text ?? ""),
    ].join("\n"),
  );

  const clauses = draft
    .split(/[.!?]|,(?=\s|$)/)
    .map((c) => c.trim())
    .filter(Boolean);
  if (clauses.length === 0) return content;

  let boilerplateCount = 0;
  let groundedClauseCount = 0;
  let ungroundedBoilerplateCount = 0;
  for (const clause of clauses) {
    const folded = fold(clause);
    const window = folded.slice(0, Math.min(folded.length, 25));
    const grounded = window.length >= 15 && sourceBlob.includes(window);
    if (grounded) groundedClauseCount++;
    const isBoilerplate = EXAM_BOILERPLATE_PATTERNS.some((re) =>
      re.test(folded),
    );
    if (isBoilerplate) {
      boilerplateCount++;
      if (!grounded) ungroundedBoilerplateCount++;
    }
  }

  // Short draft: any ungrounded boilerplate clause strips the whole
  // section. Covers "Pacient pri vedomí, orientovaný." style residues.
  if (clauses.length <= 2 && ungroundedBoilerplateCount > 0) {
    return "";
  }

  // Long draft: require the majority to be boilerplate AND zero
  // grounded clauses before stripping.
  const boilerplateRatio = boilerplateCount / clauses.length;
  if (boilerplateRatio > 0.6 && groundedClauseCount === 0) {
    return "";
  }
  return content;
}

export function findZaverSection(
  template: Template,
  language: Language = "sk",
): {
  id: string;
  title: string;
  context: string;
  reconcilers?: string[];
  critic?: boolean;
} | null {
  const walk = (sections: TemplateSection[]): TemplateSection | null => {
    for (const s of sections) {
      if (s.subsections?.length) {
        const hit = walk(s.subsections);
        if (hit) return hit;
      } else if (isZaverSection(s)) {
        return s;
      }
    }
    return null;
  };
  const section = walk(template.sections);
  if (!section) return null;
  return {
    id: section.id,
    title: resolveLabel(section, language),
    context: section.context ?? "",
    reconcilers: section.reconcilers,
    critic: section.critic,
  };
}

export type OnSectionCallback = (
  section: RenderedSection,
) => void | Promise<void>;

export interface GenerateNoteInput {
  template: Template;
  source: RawSource;
  language: SupportedLanguage;
  /**
   * Fired each time a section's state changes:
   *   - FIRST call per section id: the raw draft (streaming).
   *   - SECOND call per section id (optional): corrected critic output
   *     + reconcilers. UI replaces by id. Fires only on
   *     critic-enabled sections AND when the critic actually changed
   *     the content.
   */
  onSection?: OnSectionCallback;
  /** Propagates `userId` / `visitId` so each Claude call is logged. */
  usage?: UsageContext;
  /**
   * When provided, only render these leaf section ids. All other
   * leaves are skipped (the caller supplies their prior content). Used
   * by the /api/adjust route to re-render only the sections the
   * adjustment router flagged.
   */
  leafIdFilter?: Set<string>;
}

export interface GenerateNoteResult {
  /** Sections in render order (flattened; leaves only) — FINAL. */
  sections: RenderedSection[];
}

export async function generateNote(
  input: GenerateNoteInput,
): Promise<GenerateNoteResult> {
  const { template, source, language, onSection, usage, leafIdFilter } = input;
  const language4 = normalizeLanguage(language);
  const allLeaves = collectLeafSections(template.sections);
  const leaves = leafIdFilter
    ? allLeaves.filter((l) => leafIdFilter.has(l.id))
    : allLeaves;
  if (leafIdFilter) {
    logger.debug(
      `[pipeline] generateNote leafIdFilter active: ${leaves.length}/${allLeaves.length} leaves will render`,
    );
  }
  const templateSystemPrompt = template.systemPrompt?.trim() || undefined;

  const sectionExamplesMap = buildSectionExamplesMap(
    template.styleExamples,
    template,
  );
  if (sectionExamplesMap.size > 0) {
    logger.debug(
      `[pipeline] section-examples corpus: ${sectionExamplesMap.size} section(s) have voice examples`,
    );
  }

  const final = new Map<string, RenderedSection>();
  const order: string[] = [];
  const criticPromises: Array<Promise<void>> = [];

  for (const leaf of leaves) {
    const title = resolveLabel(leaf, language4);

    if (isZaverSection(leaf)) {
      logger.debug(
        `[pipeline] skipping Záver section (${leaf.id}) — populated from ICD suggester`,
      );
      continue;
    }

    const context = leaf.context?.trim();
    if (!context) {
      logger.debug(`[pipeline] skipping ${leaf.id} — no context configured`);
      continue;
    }

    const config: SectionConfig = {
      id: leaf.id,
      title,
      context,
      model: leaf.model ?? "haiku",
      reconcilers: leaf.reconcilers,
      critic: leaf.critic,
    };

    // Voice examples help for narrative sections (TO, OA, Záver…) where
    // tone and structure matter. For structural vitals (single-value
    // numbers) AND exam-narrative sections (Celkové vyšetrenie /
    // Celkový stav) the "example" IS the concrete finding, and Haiku
    // mimics it — producing phantom vitals or generic "normal exam"
    // boilerplate when the current source has no corresponding data.
    // Skip examples for both categories; the hardened contracts gate
    // output on whether real findings exist in the source.
    const isVitalSection = isStructuralVitalLabel(title);
    const skipExamples = isVitalSection || isExamNarrativeLabel(title);
    const examples = skipExamples ? undefined : sectionExamplesMap.get(leaf.id);
    if (skipExamples) {
      logger.debug(`[pipeline] skipping examples for "${title}" (${leaf.id})`);
    }

    let draft: RenderedSection;
    try {
      draft = await renderSection(
        source,
        config,
        language4,
        usage,
        templateSystemPrompt,
        examples,
      );
    } catch (err) {
      logger.error(`[pipeline] section ${leaf.id} failed:`, err);
      draft = { id: leaf.id, title, content: "" };
    }

    // Post-render grounding check for NUMERIC vitals sections. The
    // first version of this check was pure digit-substring matching,
    // which stripped legitimate Slovak word → digit translations
    // ("stotridsaťpäť" in source, "135" in draft). The current version
    // accepts digits OR their Slovak number-word forms (see
    // toSlovakNumberForms). Single digits 0–9 are skipped to avoid
    // trivial false-strips on lead labels like V1, II, stp.
    if (isVitalSection && draft.content.trim().length > 0) {
      const stripped = stripUngroundedVitalValue(draft.content, source);
      if (stripped !== draft.content) {
        logger.debug(
          `[pipeline] stripped ungrounded value from "${title}" (${leaf.id}): "${draft.content.trim()}"`,
        );
        draft = { ...draft, content: stripped };
      }
    }

    // Post-render boilerplate check for NARRATIVE exam sections —
    // Celkové vyšetrenie / Celkový stav / Fyzikálne vyšetrenie. The
    // prompt's "forbidden fallbacks" list + the hardened contract
    // should suppress generic "normal exam" sentences, but Haiku
    // sometimes drifts back. If the draft is dominated by
    // unsourceable boilerplate clauses, force empty.
    if (isExamNarrativeLabel(title) && draft.content.trim().length > 0) {
      const stripped = stripBoilerplateExam(draft.content, source);
      if (stripped !== draft.content) {
        logger.debug(
          `[pipeline] stripped boilerplate exam from "${title}" (${leaf.id}): "${draft.content.trim().slice(0, 100)}"`,
        );
        draft = { ...draft, content: stripped };
      }
    }

    // If no critic: run reconcilers immediately, then emit final.
    if (!config.critic) {
      const finalContent = applyReconcilers(
        draft.content,
        config.reconcilers,
        source,
        language4,
      );
      const result: RenderedSection = { ...draft, content: finalContent };
      order.push(result.id);
      final.set(result.id, result);
      if (onSection) await onSection(result);
      continue;
    }

    // Critic enabled: emit the draft right away so the UI streams,
    // then run the critic in the background. When it finishes, run
    // reconcilers on the critic output and emit the updated section.
    order.push(draft.id);
    final.set(draft.id, draft);
    if (onSection) await onSection(draft);

    const criticPromise = (async () => {
      try {
        const corrected = await runCriticAndReconcilers({
          draftContent: draft.content,
          source,
          config,
          language: language4,
          usage,
        });
        if (corrected !== draft.content) {
          const updated: RenderedSection = {
            ...draft,
            content: corrected,
            draft: draft.content,
          };
          final.set(updated.id, updated);
          if (onSection) await onSection(updated);
        } else {
          // No change — still apply reconcilers (critic doesn't, it's a
          // different responsibility). But in the common case (critic
          // returned unchanged AND reconcilers don't change either), the
          // draft is the final. Apply reconcilers anyway for safety.
          const finalContent = applyReconcilers(
            draft.content,
            config.reconcilers,
            source,
            language4,
          );
          if (finalContent !== draft.content) {
            const updated: RenderedSection = {
              ...draft,
              content: finalContent,
            };
            final.set(updated.id, updated);
            if (onSection) await onSection(updated);
          }
        }
      } catch (err) {
        logger.error(`[pipeline] critic (bg) failed for ${leaf.id}:`, err);
        // On critic failure, still run reconcilers and emit so the UI
        // isn't left with the raw draft when a deterministic fix could
        // have applied.
        try {
          const finalContent = applyReconcilers(
            draft.content,
            config.reconcilers,
            source,
            language4,
          );
          if (finalContent !== draft.content) {
            const updated: RenderedSection = {
              ...draft,
              content: finalContent,
            };
            final.set(updated.id, updated);
            if (onSection) await onSection(updated);
          }
        } catch (err2) {
          logger.error(
            `[pipeline] reconciler fallback failed for ${leaf.id}:`,
            err2,
          );
        }
      }
    })();
    criticPromises.push(criticPromise);
  }

  await Promise.all(criticPromises);

  const sections = order
    .map((id) => final.get(id))
    .filter((s): s is RenderedSection => !!s);
  return { sections };
}

/**
 * Run critic (if applicable) + reconcilers on a piece of section
 * content. Exported for the route to use on the Záver slot (fed by the
 * ICD suggester). Returns the final corrected content. Never throws —
 * falls back to draft-plus-reconcilers on critic failure.
 */
export async function runCriticAndReconcilers(args: {
  draftContent: string;
  source: RawSource;
  config: SectionConfig;
  language: Language;
  usage?: UsageContext;
}): Promise<string> {
  const { draftContent, source, config, language, usage } = args;
  if (!draftContent.trim()) return draftContent;

  let content = draftContent;

  if (config.critic) {
    try {
      const result = await criticPass({
        draft: draftContent,
        source,
        sectionId: config.id,
        sectionTitle: config.title,
        sectionContext: config.context,
        language,
        usage,
      });
      if (result.changed) {
        logger.debug(
          `[pipeline] critic modified "${config.title}" — ${result.diffSummary}`,
        );
      }
      content = result.content;
    } catch (err) {
      logger.error(`[pipeline] critic failed for "${config.title}":`, err);
    }
  }

  // Post-critic boilerplate check — for narrative exam sections, a
  // residual sentence from the forbidden-fallback list ("Pacient pri
  // vedomí, orientovaný", etc.) can survive the critic pass. Re-run
  // the same strip we apply on the pre-critic draft.
  if (isExamNarrativeLabel(config.title) && content.trim().length > 0) {
    const stripped = stripBoilerplateExam(content, source);
    if (stripped !== content) {
      logger.debug(
        `[pipeline] post-critic boilerplate strip for "${config.title}"`,
      );
      content = stripped;
    }
  }

  // Safety net — strip absence-description leaks from the critic output
  // (same guard the section-agent applies to its own draft). Catches
  // analytical essays Haiku sometimes writes when it decides the
  // section should be empty.
  if (isAbsenceDescription(content)) {
    content = "";
  }

  return applyReconcilers(content, config.reconcilers, source, language);
}

function applyReconcilers(
  content: string,
  names: string[] | undefined,
  source: RawSource,
  language: Language,
): string {
  let out = content;
  for (const name of names ?? []) {
    const reconciler = RECONCILERS[name];
    if (!reconciler) throw new Error(`Unknown reconciler: ${name}`);
    out = reconciler(out, source, { language });
  }
  return out;
}

function collectLeafSections(sections: TemplateSection[]): TemplateSection[] {
  const out: TemplateSection[] = [];
  for (const s of sections) {
    if (s.subsections && s.subsections.length > 0) {
      out.push(...collectLeafSections(s.subsections));
    } else {
      out.push(s);
    }
  }
  return out;
}

function resolveLabel(section: TemplateSection, language: Language): string {
  return (
    section.labels[language] ??
    section.labels.en ??
    section.labels[Object.keys(section.labels)[0]] ??
    section.id
  );
}

function normalizeLanguage(language: SupportedLanguage): Language {
  if (language === "sk" || language === "cs" || language === "en") {
    return language;
  }
  return "en";
}
