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
  type Language,
  type RawSource,
  type RenderedSection,
  type SectionConfig,
  type UsageContext,
} from "./section-agent";
import { buildSectionExamplesMap } from "../templates/reference-notes";
import { normalizeLabel } from "../parse-note-sections";
import { criticPass, type CriticModel } from "./critic";
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

/** Medication list section labels across sk/cs/en. */
const LA_LABELS = new Set<string>([
  "la",
  "liekova anamneza",
  "lekova anamneza",
  "medications",
  "current medications",
  "medication list",
  "home medications",
  "meds",
]);

function isLaTitle(title: string): boolean {
  return LA_LABELS.has(normalizeLabel(title));
}


/**
 * Common Slovak medical transcription typos that slip past the
 * section-agent + critic. Each entry is [wrong, right]. Matching is
 * word-boundary + case-insensitive; the correction preserves the
 * original case pattern only when the wrong form is all-lowercase or
 * capitalised (MiXeD case like "HeMtÓMu" is normalised to "Hematómu").
 *
 * Keep the list SHORT and deterministic. Only add entries when the
 * wrong form is clearly nonsense Slovak — never fold legitimate
 * variants.
 */
const MEDICAL_TYPO_CORRECTIONS: Array<[wrong: string, right: string]> = [
  ["hemtóm", "hematóm"], // "hemtómu" → "hematómu" (observed in prod)
  ["infrkt", "infarkt"],
  ["dyspoe", "dyspnoe"],
  ["koronografia", "koronarografia"],
  ["echokardiogrfia", "echokardiografia"],
  ["hypertnzia", "hypertenzia"],
];

export function fixKnownMedicalTypos(text: string): string {
  if (!text.trim()) return text;
  let out = text;
  for (const [wrong, right] of MEDICAL_TYPO_CORRECTIONS) {
    // Replace the typo stem; Slovak case endings ("hemtómu", "hemtómom")
    // re-attach because we match the stem only.
    const escaped = wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "gi");
    out = out.replace(re, (match) => {
      // Preserve leading case: "Hemtóm" → "Hematóm", "hemtóm" → "hematóm".
      if (match[0] === match[0].toUpperCase()) {
        return right[0].toUpperCase() + right.slice(1);
      }
      return right;
    });
  }
  return out;
}

/**
 * For structural vital sections (Pulz / TK / Výška / Hmotnosť / BMI /
 * EKG), every Arabic-digit run in the draft must also appear in the
 * raw source blob. When ANY digit token is missing, strip the section
 * to empty — voice examples + ambient training data routinely leak
 * phantom "SF 68/min" / "TK 120/80" that the critic misses because the
 * numbers look clinically plausible.
 *
 * Digits are language-agnostic — this check works across sk/cs/en/any
 * locale that writes Arabic numerals. Does NOT attempt Slovak number
 * words ("sto tridsaťpäť"); if the model paraphrases word→digit, it
 * must do so with a digit actually present in the source, otherwise the
 * vital is dropped as ungrounded. That's the safe default.
 */
export function stripUngroundedVitalValue(
  draft: string,
  source: RawSource,
): string {
  const trimmed = draft.trim();
  if (!trimmed) return draft;

  const digitTokens = Array.from(trimmed.matchAll(/\d+/g)).map((m) => m[0]);
  if (digitTokens.length === 0) return draft;

  const sourceBlob = [
    source.transcript ?? "",
    source.doctorNotes ?? "",
    ...(source.files ?? []).map((f) => f.text ?? ""),
  ].join("\n");

  for (const tok of digitTokens) {
    if (!sourceBlob.includes(tok)) {
      logger.debug(
        `[pipeline] strip ungrounded vital: digit "${tok}" not in source — dropping "${trimmed.slice(0, 60)}"`,
      );
      return "";
    }
  }
  return draft;
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
    // Skip examples for both categories; the claims-grounding gate
    // still catches outright invention but voice leaks are much
    // stronger than per-section regex for these slots.
    const skipExamples =
      isStructuralVitalLabel(title) || isExamNarrativeLabel(title);
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

    // Structural-vital guard: ungrounded digits → strip the section.
    if (isStructuralVitalLabel(title) && draft.content.trim()) {
      const grounded = stripUngroundedVitalValue(draft.content, source);
      if (grounded !== draft.content) draft = { ...draft, content: grounded };
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
      // Critic runs on Sonnet 4.6 as the default — better grounding,
      // denial discrimination, and dense-shorthand preservation across
      // the board. Exception: LA (medication list) stays on Haiku
      // because Sonnet's tighter grounding tends to drop chronic home
      // meds the OCR mentions but that aren't explicitly today's
      // prescription (observed in eval: Rytmonorm, Nolpaza). Haiku is
      // more forgiving here, which is correct for a med list where
      // completeness beats strict grounding.
      // Latency is unaffected — critic calls run in parallel.
      const criticModel: CriticModel = isLaTitle(config.title)
        ? "haiku"
        : "sonnet";
      const result = await criticPass({
        draft: draftContent,
        source,
        sectionId: config.id,
        sectionTitle: config.title,
        sectionContext: config.context,
        language,
        usage,
        model: criticModel,
      });
      if (result.changed) {
        logger.debug(
          `[pipeline] critic (${criticModel}) modified "${config.title}" — ${result.diffSummary}`,
        );
      }
      content = result.content;
    } catch (err) {
      logger.error(`[pipeline] critic failed for "${config.title}":`, err);
    }
  }

  // Structural-vital guard: catch any digit the critic added or
  // preserved that isn't in the source.
  if (isStructuralVitalLabel(config.title) && content.trim()) {
    content = stripUngroundedVitalValue(content, source);
  }

  // The critic already uses tool-use (`submit_corrected_section`) so
  // it can't leak meta-commentary essays; the section-agent handles its
  // own absence-description stripping via `isAbsenceDescription`.
  // `applyReconcilers` also runs the deterministic medical-typo fix.
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
  // Universal last-pass: safe allowlist of Slovak medical typo fixes
  // (hemtóm → hematóm, etc.). Runs on every section, after any
  // configured reconcilers.
  return fixKnownMedicalTypos(out);
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
