import Anthropic from "@anthropic-ai/sdk";
import type { SupportedLanguage } from "./types";
import type { Template, TemplateSection } from "./templates/types";
import { buildTemplateHtml, flattenSectionIds } from "./templates/html";
import { logUsage, type UsageContext } from "./usage";
import {
  buildEnrichedSystemPrompt,
  buildPreRenderedIcdBlock,
} from "./clinical/pipeline";
import { extractJson } from "./clinical/json-repair";
import {
  validateIcdDescriptions,
  extractIcdCodesFromSections,
  resolveIcdCodes,
} from "./clinical/icd-index";
import { extractSectionsFromStream } from "./api/sse";
import type {
  CandidateIcdCode,
  ClinicalAnalysis,
  SpecialtyId,
} from "./clinical/types";
import { getSpecialtyPromptPack } from "./clinical/specialty-prompts";
import type { ExtractedFacts } from "./clinical/fact-extraction";
import { countFacts, formatFactsForPrompt } from "./clinical/fact-validator";
import {
  assignFactsToSections,
  formatAssignedFactsForPrompt,
} from "./clinical/fact-section-assigner";
import { scrubPhi } from "./clinical/phi-scrubber";
import { runSanityGate } from "./clinical/sanity-gate";
import type { SanityReport } from "./clinical/sanity-gate";
import { renderSections } from "./clinical/section-renderer";
import { buildEncounterModel } from "./clinical/encounter-model";
import {
  renderAssessmentFromModel,
  modelHasAnyProblem,
} from "./clinical/renderers/assessment";
import { classifySection } from "./clinical/section-routing-validator";
import { enforceSectionPurity } from "./clinical/section-purity";
import { logger } from "@/lib/logger";

export class InsufficientContextError extends Error {
  constructor() {
    super("insufficient_context");
    this.name = "InsufficientContextError";
  }
}

let _anthropic: Anthropic | null = null;
export function anthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ maxRetries: 4 });
  return _anthropic;
}

export const NOT_STATED: Record<SupportedLanguage, string> = {
  en: "Not stated",
  sk: "Neuvedené",
  cs: "Neuvedeno",
};

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: "English",
  sk: "Slovak",
  cs: "Czech",
};

/** Matches bullet-style list prefixes at the start of a line. */
const BULLET_PREFIX_RE = /^\s*[-•–—*]\s+/gm;

/**
 * Strip bullet markers from the start of lines in generated text.
 * Defensive post-processing — even if the prompt tells the model not to
 * use bullets, it often does anyway.
 */
export function stripBulletMarkers(text: string): string {
  if (!text) return text;
  return text.replace(BULLET_PREFIX_RE, "");
}

/**
 * Collect IDs of template sections that have subsections.
 * Content for these parent sections should be empty — all content
 * goes into the child subsections.
 */
function collectParentSectionIds(sections: TemplateSection[]): Set<string> {
  const parents = new Set<string>();
  function walk(list: TemplateSection[]) {
    for (const s of list) {
      if (s.subsections && s.subsections.length > 0) {
        parents.add(s.id);
        walk(s.subsections);
      }
    }
  }
  walk(sections);
  return parents;
}

/**
 * Build a lean system prompt for the facts-present path.
 *
 * When validated facts have been pre-assigned to sections by the
 * deterministic pipeline (Pass 1.5 → 1.6a/b → fact-to-section), the
 * LLM's job is purely *formatting*, not clinical reasoning. This prompt
 * strips out ~60 % of the token budget by removing rules that are
 * already enforced upstream:
 *
 *  - Insufficient context check → impossible when validated facts exist
 *  - Verbose grounding / NO ASSUMPTION MODE → enforced by Pass 1.5 rules
 *  - Source priority hierarchy → facts are the single source of truth
 *  - Title rules → title generated in a dedicated Haiku call
 *  - Section routing rules (8a-8h) → facts already pre-assigned to sections
 *
 * Falls through to the full `buildTemplateSystemPrompt` when the template
 * uses a custom `systemPrompt` — custom prompts bypass this optimisation.
 */
export function buildFactBasedSystemPrompt(
  template: Template,
  language: SupportedLanguage,
  sectionLabels: Record<string, string>,
  sectionContexts?: Record<string, string>,
): string {
  const langLabel = LANGUAGE_LABELS[language];
  const allIds = flattenSectionIds(template);

  const sectionList = allIds
    .map((id) => {
      const label = sectionLabels[id] || id;
      const context = sectionContexts?.[id];
      if (context) {
        return `- "${id}": ${label}\n  SECTION-SPECIFIC GUIDANCE (ALWAYS FOLLOW THIS): ${context}`;
      }
      return `- "${id}": ${label}`;
    })
    .join("\n");

  const styleGuideBlock = template.styleGuide
    ? `\n\nWRITING STYLE GUIDE:\nMimic the following writing style in your output. Match the tone, sentence structure, formatting preferences, abbreviation usage, and level of detail described below:\n${template.styleGuide}\n`
    : "";

  const interpolate = (prompt: string) =>
    prompt
      .replace(/\{\{sections\}\}/g, sectionList)
      .replace(/\{\{language\}\}/g, langLabel)
      .replace(/\{\{languageCode\}\}/g, language)
      .replace(/\{\{styleGuide\}\}/g, styleGuideBlock);

  // Custom prompts bypass the fact-based optimisation
  if (template.systemPrompt) {
    return interpolate(template.systemPrompt);
  }

  return interpolate(`You are a medical documentation assistant. You MUST follow these rules strictly:

CRITICAL — SECTION-SPECIFIC GUIDANCE OVERRIDES ALL:
If a section below has "SECTION-SPECIFIC GUIDANCE", that guidance ALWAYS takes absolute precedence over any general rule or instruction. Follow section-specific guidance exactly as written, even if it contradicts other rules.

1. FACT VALUE FIDELITY: The pre-assigned validated clinical facts are the sole source of clinical truth. Your job is to FORMAT them into the note, not to REWRITE them.
   - Reproduce each fact's wording as closely as possible. Only adjust grammatical case, declension, or word order as minimally needed for natural {{language}} text.
   - Do NOT rephrase, paraphrase, elaborate, summarize, or add explanatory context beyond what the fact states.
   - Do NOT merge multiple facts into compound sentences — present each fact as a distinct statement on its own line.
   - Present facts within each section in the EXACT order they appear in the input. Do NOT reorder facts.
   - If a section has pre-assigned facts, its content MUST be derived exclusively from those facts — do not add information from other sections or from general clinical knowledge.
   - The same facts must produce the same output text every time. Treat this as a formatting task, not a creative writing task.

2. NEVER FABRICATE MISSING CLINICAL DIMENSIONS: If a numeric value appears WITHOUT a unit or dimension, you MUST NOT invent the missing dimension. Preserve the raw value and mark the ambiguity — e.g. "fajčí 15 (bližšie nešpecifikované)". This applies to frequency, duration, laterality, severity, dosage, route, and temporal anchors. Correctness > completeness.

3. DIRECTIVES: Doctor's additional notes and per-file directives (lines starting with "DOCTOR'S DIRECTIVE FOR THIS FILE:") are authoritative. Follow them as strict filters.

4. OUTPUT LANGUAGE: Write ALL content exclusively in {{language}}. Only exceptions: established Latin/international medical terminology and proper nouns.

5. MISSING SECTIONS: If a section has no relevant information, output an empty string "" for that key. Do NOT write placeholder text.

6. FORMATTING — ABSOLUTELY NO BULLET POINTS OR LIST MARKERS:
   NEVER use bullet points, dashes, or list markers anywhere. No "- ", no "• ", no "* ", no "– ". This is the most critical formatting rule.
   Write everything as dense flowing prose or one item per line (plain text, no leading markers).

   WRONG (never do this):
   "- I10 Esenciálna hypertenzia\n- I48 Fibrilácia predsiení"
   "- Euthyrox 112 ug 1-0-0\n- Betaloc ZOK 25 mg 1-0-0"
   "- alergia na Candibene\n- alergia na mukolytiká"
   "- Koronarografia cez pravú ruku\n- Kontrola u lekára do 3 dní"

   CORRECT (always do this):
   "I10 Esenciálna hypertenzia\nI48 Fibrilácia predsiení"
   "Euthyrox 112 ug 1-0-0, Betaloc ZOK 25 mg 1-0-0, Nolpaza 20 mg 1-0-0"
   "alergia na Candibene a mukolytiká, na iné lieky neguje"
   "Koronarografia cez pravú ruku s možnosťou intervencie. Kontrola u lekára do 3 dní."

   Section-specific formatting:
   Diagnoses/ICD codes: one per line, code first then name, NO prefix.
   Medications: compact comma-separated inline (all meds in one line/paragraph).
   Allergies: compact comma-separated inline (all allergies in one sentence).
   History (OA, RA, SA, PA, Ab): compact flowing prose, comma-separated.
   Examination/findings: dense flowing prose with measurements inline.
   Plans: write as flowing sentences, NOT itemized.

7. PARENT SECTIONS WITH SUBSECTIONS: If a section has subsections (e.g. Anamnézy with RA, OA, SA, etc.), output an empty string "" for the PARENT section — all content MUST go into the subsections only. NEVER write content directly under a parent header.

8. FORMAT: Return valid JSON with one key for each section ID listed below (string value, or "" if empty). No other keys.

9. ASSESSMENT SCOPE: The Záver/Assessment section must be CONCISE. Include ONLY active current problems and management-relevant chronic conditions. Do NOT list every historical diagnosis. Background-only conditions go ONLY in OA.

10. NEGATED FACTS: a fact prefixed with "[NEGATED]" documents the ABSENCE of the finding (pertinent negative) — the doctor deliberately recorded that this symptom, finding, or medication is NOT present / NOT taken. Render it as a natural negation in {{language}} that flows with the section:
    - Slovak: "bez <genitív>" ("bez dušnosti"), "neguje <akuzatív>" ("neguje nauzeu"), "neudáva <akuzatív>" ("neudáva bolesť hlavy").
    - Czech: "bez <genitiv>", "neguje", "neudává".
    - English: "no <noun>", "denies <noun>", "no evidence of <noun>".
    NEVER emit the literal string "[NEGATED]" in the output. Integrate negatives into the same section as affirmative facts of that category — pertinent negatives are clinically as important as positives, especially in the present-illness, symptoms, and examination sections.

10. HISTORY COMPRESSION: For OA, RA, SA, PA, Ab sections — compact flowing prose, comma-separated or semicolon-separated inline lists. Do NOT expand abbreviations into verbose descriptions.

TEMPLATE SECTIONS (fill each one, or "" if no relevant information):
{{sections}}
{{styleGuide}}`);
}

/**
 * Build a system prompt for template-based generation.
 *
 * This is the full-featured prompt used when validated facts are NOT
 * available (legacy path, or when fact extraction failed). It includes
 * all grounding rules, section routing, title rules, etc.
 */
export function buildTemplateSystemPrompt(
  template: Template,
  language: SupportedLanguage,
  sectionLabels: Record<string, string>,
  sectionContexts?: Record<string, string>,
): string {
  const langLabel = LANGUAGE_LABELS[language];
  const allIds = flattenSectionIds(template);

  const sectionList = allIds
    .map((id) => {
      const label = sectionLabels[id] || id;
      const context = sectionContexts?.[id];
      // If section has specific guidance, include it prominently
      if (context) {
        return `- "${id}": ${label}\n  SECTION-SPECIFIC GUIDANCE (ALWAYS FOLLOW THIS): ${context}`;
      }
      return `- "${id}": ${label}`;
    })
    .join("\n");

  // Build style guide block (empty string if no style guide)
  const styleGuideBlock = template.styleGuide
    ? `\n\nWRITING STYLE GUIDE:\nMimic the following writing style in your output. Match the tone, sentence structure, formatting preferences, abbreviation usage, and level of detail described below:\n${template.styleGuide}\n`
    : "";

  // Variable interpolation (works for both custom and default prompts)
  const interpolate = (prompt: string) =>
    prompt
      .replace(/\{\{sections\}\}/g, sectionList)
      .replace(/\{\{language\}\}/g, langLabel)
      .replace(/\{\{languageCode\}\}/g, language)
      .replace(/\{\{styleGuide\}\}/g, styleGuideBlock);

  // Use custom system prompt if set
  if (template.systemPrompt) {
    return interpolate(template.systemPrompt);
  }

  return interpolate(`You are a medical documentation assistant. You MUST follow these rules strictly:

CRITICAL — SECTION-SPECIFIC GUIDANCE OVERRIDES ALL:
If a section below has "SECTION-SPECIFIC GUIDANCE", that guidance ALWAYS takes absolute precedence over any general rule or instruction. Follow section-specific guidance exactly as written, even if it contradicts other rules.

1. INSUFFICIENT CONTEXT CHECK: Before generating, assess whether the provided input contains enough meaningful clinical information (symptoms, findings, diagnoses, treatments, etc.) to produce a useful medical note. If the input is too vague, too short, or lacks any real clinical content (e.g. just a greeting, a single word, or unrelated text), return ONLY this exact JSON: {"insufficient_context": true}. Do NOT attempt to generate a note from insufficient input.

2. STRICT GROUNDING — NO ASSUMPTION MODE: Only use information explicitly present in the provided transcript chunks, uploaded file contents, and doctor's notes. Do NOT infer, assume, estimate, or hallucinate any medical facts. If a value (age, duration, measurement, dosage, etc.) or medical fact (symptom, finding, diagnosis, procedure) is not explicitly stated, do NOT guess — omit it entirely. Do NOT upgrade diagnosis severity beyond what is explicitly stated (e.g. do not write STEMI when only non-STEMI or ACS is mentioned, do not write malignant when only benign is stated). When in doubt about severity, use the less severe term.

2a. NEVER FABRICATE MISSING CLINICAL DIMENSIONS: If a numeric value appears in the source WITHOUT a unit or dimension (e.g. the patient says "fajčím 15" with no "cigariet/deň" and no "rokov"), you MUST NOT invent the missing dimension. "15 cigariet denne" is WRONG. "fajčí 15 rokov" is WRONG. The correct behaviour is to preserve the raw value and explicitly mark the ambiguity — write e.g. "fajčí 15 (bližšie nešpecifikované)" in Slovak, "kouří 15 (blíže nespecifikováno)" in Czech, or "smokes 15 (not further specified)" in English. The same principle applies to EVERY missing clinical dimension: frequency ("per day" vs "per week"), duration ("years" vs "months"), laterality (left/right), severity, dosage strength, route of administration, temporal anchor. If the source does not literally state it, do NOT fill it in — even if one interpretation is statistically more common. Correctness > completeness: a shorter, vaguer statement is always preferable to a confident fabrication. This rule overrides any stylistic preference for complete sentences.

2b. FACT VALUE FIDELITY (when VALIDATED CLINICAL FACTS are provided): The pre-assigned facts are the sole source of clinical truth. Your job is to FORMAT them into the note, not to REWRITE them.
   - Reproduce each fact's wording as closely as possible. Only adjust grammatical case, declension, or word order as minimally needed for natural {{language}} text.
   - Do NOT rephrase, paraphrase, elaborate, summarize, or add explanatory context beyond what the fact states.
   - Do NOT merge multiple facts into compound sentences — present each fact as a distinct statement on its own line.
   - Present facts within each section in the EXACT order they appear in the input. Do not reorder facts.
   - If a section has pre-assigned facts, its content MUST be derived exclusively from those facts — do not add information from other sections or from general clinical knowledge.
   - The same facts must produce the same output text every time. Treat this as a formatting task, not a creative writing task.

3. SOURCE PRIORITY (highest to lowest):
   1. Actual spoken transcript — always takes precedence
   2. Doctor's additional notes
   3. Uploaded documents (lab results, referrals, etc.)
   If sources conflict, prefer the higher-priority source.

3a. DOCTOR NOTES AS DIRECTIVES: Doctor's additional notes may contain explicit instructions about how to process other sources — e.g. "only use the blood pressure values from the uploaded file", "ignore the old diagnosis in the referral", "use only section X from the document". When doctor notes contain such filtering or processing instructions, treat them as authoritative directives and follow them exactly. Only include information from uploaded files and transcript that the doctor's instructions permit. This rule takes precedence over completeness — it is better to omit information the doctor explicitly excluded than to include everything.

3b. PER-FILE DIRECTIVES: Individual uploaded files may contain a line starting with "DOCTOR'S DIRECTIVE FOR THIS FILE:" immediately after the file header. This directive tells you exactly what to use from that specific file. For example, if the directive says "I only want the diagnosis", use ONLY diagnosis-related information from that file — ignore all other content (demographics, measurements, findings, medications, procedures, recommendations, etc.) even if it is present. Per-file directives are strict filters and take precedence over completeness.

4. OUTPUT LANGUAGE: Write ALL content exclusively in {{language}}. The only exceptions are established Latin/international medical terminology (e.g. "status praesens", "per os") and proper nouns (drug brand names, institution names). Do not mix languages.

5. MISSING SECTIONS: If a section or subsection has no relevant information from the source material, output an empty string "" for that key. Do NOT write placeholder text like "Not stated" or "Neuvedené" — just use "".

6. FORMATTING — ABSOLUTELY NO BULLET POINTS OR LIST MARKERS:
   NEVER use bullet points, dashes, or list markers anywhere. No "- ", no "• ", no "* ", no "– ". This is the most critical formatting rule.
   Write everything as dense flowing prose or one item per line (plain text, no leading markers).

   WRONG (never do this):
   "- I10 Esenciálna hypertenzia\n- I48 Fibrilácia predsiení"
   "- Euthyrox 112 ug 1-0-0\n- Betaloc ZOK 25 mg 1-0-0"
   "- alergia na Candibene\n- alergia na mukolytiká"
   "- Koronarografia cez pravú ruku\n- Kontrola u lekára do 3 dní"

   CORRECT (always do this):
   "I10 Esenciálna hypertenzia\nI48 Fibrilácia predsiení"
   "Euthyrox 112 ug 1-0-0, Betaloc ZOK 25 mg 1-0-0, Nolpaza 20 mg 1-0-0"
   "alergia na Candibene a mukolytiká, na iné lieky neguje"
   "Koronarografia cez pravú ruku s možnosťou intervencie. Kontrola u lekára do 3 dní."

   Section-specific formatting:
   Diagnoses/ICD codes: one per line, code first then name, NO prefix.
   Medications: compact comma-separated inline (all meds in one line/paragraph).
   Allergies: compact comma-separated inline (all allergies in one sentence).
   History (OA, RA, SA, PA, Ab): compact flowing prose, comma-separated.
   Examination/findings: dense flowing prose with measurements inline.
   Plans: write as flowing sentences, NOT itemized.

7. PARENT SECTIONS WITH SUBSECTIONS: If a section has subsections (e.g. Anamnézy with RA, OA, SA, etc.), output an empty string "" for the PARENT section — all content MUST go into the subsections only. NEVER write content directly under a parent header.

8. FORMAT: Return valid JSON with one key for each section ID listed below, with the section content as a string value (or "" if no information). No other keys. Title is generated separately — do NOT include a "title" key.

9. SECTION CONTENT ROUTING — MANDATORY placement rules. Each type of clinical information MUST be placed ONLY in its designated section. Misplacing content (e.g. putting medications in TO or smoking in PA) is a critical error.

   COMMON ABBREVIATIONS used in Slovak/Czech medical templates:
   RA = Rodinná anamnéza (Family history) | OA = Osobná anamnéza (Personal/past medical history) | SA = Sociálna anamnéza (Social history — living situation, marital status, support system) | EA = Epidemiologická anamnéza (Epidemiological history — travel, exposures) | PA = Pracovná anamnéza (Work/occupational history — job, occupation, workplace exposures) | AA = Alergie (Allergies) | LA = Lieková anamnéza (Current medications — drug names, dosages, frequencies) | Ab = Abúzy (Substance use — tobacco, alcohol, recreational drugs) | TO = Terajšie ochorenie (History of present illness — chief complaint, symptom timeline, current episode narrative ONLY, NEVER medication lists)

   HARD ROUTING RULES (violations are NEVER acceptable):
   a) Medication/drug lists → ONLY in sections labeled LA, Meds, "Lieková anamnéza", "Aktuálna medikácia", or "Current medications". NEVER place medication lists in TO/HPI or any other section. The TO/HPI section is for the illness narrative only.
   b) Substance use (smoking, tobacco, alcohol, drugs, "fajčí", "pije", "tabak", "alkohol") → ONLY in sections labeled Ab, Substances, "Abúzy", "Tabak", "Alkohol". NEVER place substance use in PA (work history) or SA (social history).
   c) Work/occupation ("pracuje", "zamestnaný", "povolanie") → ONLY in sections labeled PA, OccHx, "Pracovná anamnéza", or "Work history". NEVER place work info in SA (social history).
   d) Social circumstances (living situation, marital status, support system, "býva", "žije", "slobodný/ženatý") → ONLY in sections labeled SA, SHx, "Sociálna anamnéza", or "Social history". NEVER place social info in PA (work history).
   e) Chief complaint and symptom timeline → ONLY in sections labeled TO, HPI, "Terajšie ochorenie", or "History of present illness".
   f) Family history → ONLY in sections labeled RA, FHx, "Rodinná anamnéza", or "Family history".
   g) Past medical/surgical history → ONLY in sections labeled OA, PMHx, "Osobná anamnéza", or "Past history".
   h) Allergies → ONLY in sections labeled AA, "Alergie", or "Allergies".

10. ASSESSMENT SCOPE: The Záver/Assessment section must be CONCISE. Include ONLY active current problems and management-relevant chronic conditions. Do NOT list every historical diagnosis. Background-only conditions go ONLY in OA.

11. HISTORY COMPRESSION: For OA, RA, SA, PA, Ab sections — compact flowing prose, comma-separated or semicolon-separated inline lists. Do NOT expand abbreviations into verbose descriptions.

TEMPLATE SECTIONS (fill each one, or "" if no relevant information):
{{sections}}
{{styleGuide}}`);
}

/**
 * Build the user message for template-based generation.
 *
 * When `validatedFacts` is provided together with `sectionLabels`, facts
 * are deterministically assigned to template sections before reaching Opus.
 * This eliminates cross-run variance from Opus deciding where facts go.
 *
 * When section info is not available, falls back to category-grouped
 * `formatFactsForPrompt` (legacy path).
 */
export function buildTemplateUserMessage(
  chunks: string[],
  template: Template,
  doctorNotes?: string,
  fileTexts?: { name: string; type: string; text: string; context?: string }[],
  validatedFacts?: ExtractedFacts,
  sectionLabels?: Record<string, string>,
  sectionContexts?: Record<string, string>,
  visitDate?: string,
): string {
  const allIds = flattenSectionIds(template);
  const parts: string[] = [];

  // Provide encounter date so the model can resolve temporal references
  if (visitDate) {
    const d = new Date(visitDate);
    if (!isNaN(d.getTime())) {
      const formatted = `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
      parts.push(
        `ENCOUNTER DATE: ${formatted}\nResolve "dnes" / "today" / "včera" / "yesterday" relative to this date.`,
      );
    }
  }

  if (validatedFacts && countFacts(validatedFacts) > 0) {
    // When section labels are available, assign facts to sections
    // deterministically so Opus doesn't choose where each fact goes.
    if (sectionLabels && Object.keys(sectionLabels).length > 0) {
      const assignment = assignFactsToSections(
        validatedFacts,
        sectionLabels,
        sectionContexts,
      );
      const factBlock = formatAssignedFactsForPrompt(assignment, sectionLabels);
      parts.push(
        `VALIDATED CLINICAL FACTS — PRE-ASSIGNED TO SECTIONS:\nRULES:\n1. Place ONLY the listed facts into each section — do NOT move facts between sections.\n2. Do NOT introduce clinical details, context, or information not in this list.\n3. Preserve each fact's wording as closely as possible — only adjust grammar minimally.\n4. Present facts in the EXACT order shown below within each section. Do NOT reorder.\n5. Each fact = one distinct statement on its own line. Do NOT merge facts into compound sentences. Do NOT prefix with dashes or bullet markers.\n\n${factBlock}`,
      );
    } else {
      // Fallback: category-grouped facts without section assignment
      const factList = formatFactsForPrompt(validatedFacts);
      parts.push(
        `VALIDATED CLINICAL FACTS (use ONLY these facts as the factual basis for the report — do NOT introduce clinical details that are not in this list):\n\n${factList}`,
      );
    }
  }

  // When validated facts are present they are the sole source of clinical
  // truth — including the raw transcript would give the LLM room to deviate
  // from the fact-based contract, producing cross-run inconsistencies.
  // Only include transcript when there are no validated facts (legacy path).
  if (
    chunks.length > 0 &&
    !(validatedFacts && countFacts(validatedFacts) > 0)
  ) {
    const numberedChunks = chunks
      .map((chunk, i) => `[Chunk ${i + 1}]:\n${chunk}`)
      .join("\n\n");
    parts.push(
      `Here are the transcript chunks from a medical consultation:\n\n${numberedChunks}`,
    );
  }

  if (fileTexts && fileTexts.length > 0) {
    const fileSection = fileTexts
      .map((f, i) => {
        const directive = f.context
          ? `\nDOCTOR'S DIRECTIVE FOR THIS FILE: ${f.context}`
          : "";
        return `[File ${i + 1}: ${f.name}]:${directive}\n${f.text}`;
      })
      .join("\n\n");
    parts.push(`UPLOADED FILE CONTENTS:\n\n${fileSection}`);
  }

  if (doctorNotes) {
    parts.push(`DOCTOR'S ADDITIONAL NOTES:\n${doctorNotes}`);
  }

  parts.push(
    `Fill in each template section based ONLY on the information above. Return valid JSON with keys: ${allIds.map((id) => `"${id}"`).join(", ")}.`,
  );

  return parts.join("\n\n");
}

/**
 * Model fallback chain for generation — if the primary model is overloaded,
 * try the next one in the list before giving up.
 */
export const GENERATION_MODELS = [
  "claude-opus-4-6", // Primary
  "claude-sonnet-4-6", // Fallback 1
  "claude-sonnet-4-5-20250929", // Fallback 2
  "claude-sonnet-4-20250514", // Fallback 3
] as const;

export const GENERATION_MODEL = GENERATION_MODELS[0];

/** Delay (ms) before retrying with the next fallback model. */
export const MODEL_FALLBACK_DELAY = 2000;

/** Model used for the dedicated title-generation pass. */
export const TITLE_GENERATION_MODEL = "claude-haiku-4-5-20251001";

/**
 * Build the strict system prompt for the dedicated title-generation call.
 * Exported for testing.
 */
export function buildTitleSystemPrompt(language: SupportedLanguage): string {
  const langLabel = LANGUAGE_LABELS[language];
  return `You write concise, natural-sounding encounter titles for medical notes.

STRICT RULES:
1. Output ONLY the title text — no JSON, no quotes, no explanations, no trailing punctuation.
2. Maximum 6 words.
3. Write the title in ${langLabel}.
4. Base the title ONLY on the diagnosis descriptions provided. You MAY shorten or simplify wording for readability, but you MUST NOT add any clinical detail, anatomical localisation, laterality, severity qualifier, stage, or acronym that is not already literally present in the primary diagnosis description.
5. Use the FIRST (primary) diagnosis as the basis. Ignore symptom codes (R00–R99) if a disease diagnosis is present. Ignore secondary/comorbid diagnoses.
6. Do NOT include the ICD code itself in the title.
7. When uncertain, prefer a shorter, more general wording taken verbatim from the diagnosis description.

GOOD examples:
  Diagnoses: "I21 Akútny infarkt myokardu"
  Title: Akútny infarkt myokardu

  Diagnoses: "I21.0 Akútny transmurálny infarkt myokardu prednej steny"
  Title: Akútny infarkt myokardu prednej steny

  Diagnoses: "J18.9 Zápal pľúc, nešpecifikovaný"
  Title: Zápal pľúc

BAD examples (never do this):
  Diagnoses: "I21.0 Akútny transmurálny infarkt myokardu prednej steny"
  BAD Title: "STEMI laterálnej steny" — adds "STEMI" and changes "anterior" to "lateral"
  BAD Title: "Akútny STEMI prednej steny" — adds "STEMI" which is not in the description`;
}

/**
 * Build the user message for the dedicated title-generation call.
 * Exported for testing.
 */
export function buildTitleUserMessage(icdCodes: CandidateIcdCode[]): string {
  const icdList = icdCodes.map((c) => `${c.code} ${c.description}`).join("\n");
  return `DIAGNOSES (primary first):\n${icdList}\n\nOutput only the title, nothing else.`;
}

/**
 * Clean a raw title string returned by the LLM — strip quotes, trailing
 * punctuation, and collapse whitespace. Exported for testing.
 */
export function sanitizeGeneratedTitle(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "")
    .replace(/[.!?。，、]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Generate a short, natural-sounding encounter title grounded strictly in the
 * extracted ICD codes.
 *
 * Why a dedicated pass:
 * - When we asked the main Opus generation call to produce a `title` alongside
 *   all report sections, the model would occasionally invent clinical details
 *   (e.g. "STEMI laterálnej steny" when the actual ICD was I21.0 "Akútny
 *   transmurálny infarkt myokardu prednej steny"). The title was being written
 *   from the model's own evolving interpretation, not from the validated
 *   diagnosis.
 * - This function isolates title generation into a tiny Haiku call whose ONLY
 *   input is the list of ICD codes that were actually extracted from the
 *   generated note (after CSV validation). There is no transcript, no doctor
 *   notes, no room for the model to drift.
 * - Runs at temperature 0 with a strict prompt that forbids adding anything
 *   not already present in the primary diagnosis description.
 *
 * Returns an empty string on failure or when no ICDs are available — callers
 * should fall back to the raw ICD description or a previous title.
 */
export async function generateEncounterTitle(
  icdCodes: CandidateIcdCode[],
  language: SupportedLanguage,
  ctx?: UsageContext,
): Promise<string> {
  if (icdCodes.length === 0) return "";

  const systemPrompt = buildTitleSystemPrompt(language);
  const userMessage = buildTitleUserMessage(icdCodes);

  try {
    const response = await anthropic().messages.create({
      model: TITLE_GENERATION_MODEL,
      max_tokens: 64,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    if (ctx) {
      logUsage({
        userId: ctx.userId,
        visitId: ctx.visitId,
        provider: "anthropic",
        model: TITLE_GENERATION_MODEL,
        operation: "generate_title",
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      });
    }

    const raw =
      response.content[0]?.type === "text" ? response.content[0].text : "";
    return sanitizeGeneratedTitle(raw);
  } catch (err) {
    logger.warn(
      `[generate] Dedicated title generation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return "";
  }
}

/**
 * Generate a medical document from a template, transcript chunks, and optional doctor notes.
 *
 * Uses single-pass Opus generation with fallback chain for reliability.
 */

export async function generateFromTemplate(
  chunks: string[],
  template: Template,
  language: SupportedLanguage,
  sectionLabels: Record<string, string>,
  doctorNotes?: string,
  fileTexts?: { name: string; type: string; text: string; context?: string }[],
  ctx?: UsageContext,
  clinicalAnalysis?: ClinicalAnalysis,
  sectionContexts?: Record<string, string>,
  onSection?: (id: string, title: string, content: string) => void,
  validatedFacts?: ExtractedFacts,
  visitDate?: string,
  patientName?: string,
  patientId?: string,
): Promise<{
  generatedNote: string;
  suggestedTitle: string;
  extractedIcdCodes: CandidateIcdCode[];
  /** Exact system prompt sent to the generator (for fingerprinting). */
  systemPrompt: string;
  /** Exact user message sent to the generator (for fingerprinting). */
  userMessage: string;
  /** Structured sanity report produced by the post-render gate. */
  sanityReport: SanityReport;
}> {
  const allIds = flattenSectionIds(template);
  const sectionIdSet = new Set(allIds);

  // Determine whether we have validated facts and can use the tiered path.
  const hasValidatedFacts = !!(
    validatedFacts && countFacts(validatedFacts) > 0
  );

  // Use tiered rendering whenever validated facts are present. A custom
  // `template.systemPrompt` USED to disable this path, but its main role
  // is formatting guidance that the tiered Opus prompt already enforces
  // — the legacy path leaked Opus into Assessment/vitals/meds and
  // degraded Záver into a flat diagnosis dump. When both are set we
  // piggy-back the custom prompt as `styleGuide` so doctor-provided
  // tone / abbreviation preferences still apply, but the deterministic
  // pipeline runs for the sections that benefit from it.
  const useTieredRendering = hasValidatedFacts;
  if (hasValidatedFacts && template.systemPrompt) {
    logger.debug(
      "[generate] Template has a custom systemPrompt; tiered rendering still runs with it piped through as styleGuide.",
    );
  }

  // Build user message for fingerprinting (even for tiered path)
  const userMessage = buildTemplateUserMessage(
    chunks,
    template,
    doctorNotes,
    fileTexts,
    validatedFacts,
    sectionLabels,
    sectionContexts,
    visitDate,
  );

  // Build system prompt for fingerprinting (even for tiered path)
  let systemPrompt = hasValidatedFacts
    ? buildFactBasedSystemPrompt(
        template,
        language,
        sectionLabels,
        sectionContexts,
      )
    : buildTemplateSystemPrompt(
        template,
        language,
        sectionLabels,
        sectionContexts,
      );
  if (clinicalAnalysis) {
    const templateSpecialty = template.specialties?.[0] as
      | SpecialtyId
      | undefined;
    if (templateSpecialty && getSpecialtyPromptPack(templateSpecialty)) {
      clinicalAnalysis = {
        ...clinicalAnalysis,
        inferredSpecialty: templateSpecialty,
      };
    }
    systemPrompt = buildEnrichedSystemPrompt(
      systemPrompt,
      clinicalAnalysis,
      language,
      hasValidatedFacts,
    );
  }

  const sectionContents: Record<string, string> = {};

  // Pre-compute the ICD block at the outer scope so the sanity gate can
  // use it as an auto-rerender source for an empty Assessment section.
  // Used by both the tiered renderer (below) and the gate (further down).
  const preRenderedIcdBlock = clinicalAnalysis
    ? buildPreRenderedIcdBlock(clinicalAnalysis.candidateIcdCodes)
    : undefined;

  // Stage 3 — Build the EncounterModel (single source of truth).
  // One place decides: primary/secondary/chronic/differential, objective
  // groupings (vitals/labs/ecg/imaging/exam), history slots. Every
  // downstream renderer consumes this model and may only format.
  const encounterModel =
    clinicalAnalysis && validatedFacts
      ? buildEncounterModel({
          language,
          visitDate,
          facts: validatedFacts,
          candidateIcdCodes: clinicalAnalysis.candidateIcdCodes,
        })
      : null;

  // Assessment / Záver deterministic rendering from the model. This
  // replaces the old `buildStructuredAssessment` + `cleanStructuredAssessment`
  // + `renderStructuredAssessment` pipeline with a single model read.
  const structuredAssessmentText =
    encounterModel && modelHasAnyProblem(encounterModel)
      ? renderAssessmentFromModel(encounterModel)
      : undefined;

  if (useTieredRendering) {
    // ── TIERED PATH: deterministic + Haiku + Opus in parallel ──
    logger.debug(
      "[generate] Using tiered section rendering (deterministic + Haiku + Opus)",
    );

    const factAssignment = assignFactsToSections(
      validatedFacts!,
      sectionLabels,
      sectionContexts,
    );

    // Prefer the structured Assessment rendering when available — the
    // renderer consumes `icdBlock` verbatim, so passing the structured
    // text here replaces the flat "- CODE description" dump with the
    // primary / secondary / chronic / differential bucketed form.
    const icdBlock = structuredAssessmentText ?? preRenderedIcdBlock;

    const templateSpecialty = template.specialties?.[0];

    // Merge custom systemPrompt into styleGuide — the tiered Opus prompt
    // enforces the structural rules; a template's custom prompt now
    // contributes tone / abbreviation / phrasing preferences only.
    const mergedStyleGuide =
      template.systemPrompt && template.styleGuide
        ? `${template.styleGuide}\n\n${template.systemPrompt}`
        : (template.styleGuide ?? template.systemPrompt);

    const { sectionContents: rendered } = await renderSections(
      template,
      sectionLabels,
      factAssignment,
      language,
      {
        sectionContexts,
        icdBlock,
        clinicalAnalysis,
        encounterModel: encounterModel ?? undefined,
        chunks,
        doctorNotes,
        fileTexts,
        visitDate,
        styleGuide: mergedStyleGuide,
        templateSpecialty,
        onSection,
      },
      ctx,
    );

    for (const id of allIds) {
      sectionContents[id] = rendered[id] ?? "";
    }

    // Simplified post-processing for tiered path:
    // Pass A — strip bullet markers (Haiku/Opus may still produce them)
    for (const id of allIds) {
      if (sectionContents[id]) {
        sectionContents[id] = stripBulletMarkers(sectionContents[id]);
      }
    }

    // Pass B — clear parent sections
    const parentIds = collectParentSectionIds(template.sections);
    for (const id of parentIds) {
      sectionContents[id] = "";
    }

    // Pass C has been folded into the sanity gate below — it runs on the
    // PHI-scrubbed output so we catch PHI-only lines and misrouted content
    // in a single pass with a structured report.
  } else {
    // ── LEGACY PATH: single Opus call (unchanged) ──
    logger.debug(
      `[generate] Using legacy single-model generation — system: ${systemPrompt.length} chars, user: ${userMessage.length} chars`,
    );

    const startTime = Date.now();
    let accumulated = "";
    const emittedSections = new Set<string>();

    const stream = anthropic().messages.stream({
      model: GENERATION_MODEL,
      max_tokens: 8192,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    stream.on("text", (delta) => {
      accumulated += delta;
      if (onSection) {
        extractSectionsFromStream(
          accumulated,
          sectionIdSet,
          emittedSections,
          sectionLabels,
          onSection,
        );
      }
    });

    const finalMessage = await stream.finalMessage();

    const elapsed = Date.now() - startTime;
    logger.debug(
      `[generate] Generation (${GENERATION_MODEL}) — ${elapsed}ms, tokens: ${finalMessage.usage.input_tokens} in / ${finalMessage.usage.output_tokens} out`,
    );

    if (ctx) {
      logUsage({
        userId: ctx.userId,
        visitId: ctx.visitId,
        provider: "anthropic",
        model: GENERATION_MODEL,
        operation: "generate_template",
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
      });
    }

    const text =
      finalMessage.content[0].type === "text"
        ? finalMessage.content[0].text
        : "";

    const parsed = extractJson<Record<string, string | boolean>>(text);

    if (parsed.insufficient_context === true) {
      throw new InsufficientContextError();
    }

    delete parsed.letter;
    delete parsed.title;

    for (const id of allIds) {
      const value = parsed[id];
      sectionContents[id] = typeof value === "string" ? value : "";
    }

    // Post-processing Pass A — strip bullet markers
    for (const id of allIds) {
      if (sectionContents[id]) {
        sectionContents[id] = stripBulletMarkers(sectionContents[id]);
      }
    }

    // Post-processing Pass B — clear parent sections
    const parentIds = collectParentSectionIds(template.sections);
    for (const id of parentIds) {
      sectionContents[id] = "";
    }

    // Pass C has been folded into the sanity gate below — see the post-
    // PHI-scrub block for the unified content-routing + PHI-only-line
    // stripping pass with a structured report.
  }

  // ── Common post-processing (both paths) ──

  // Validate ICD descriptions against canonical CSV data.
  // When validated facts are present, the ICD block was pre-rendered by
  // buildPreRenderedIcdBlock — skip overwriting to preserve the doctor's
  // original wording alongside the ICD code.
  if (!hasValidatedFacts) {
    for (const id of allIds) {
      if (sectionContents[id]) {
        sectionContents[id] = validateIcdDescriptions(
          sectionContents[id],
          language,
        );
      }
    }
  }

  // Pass 2.05 — Structured Assessment override. When we have a
  // StructuredAssessment with content, it is the single source of truth
  // for the Záver section. Overwrite any section classified as the
  // "assessment" role with the deterministic bucketed render so Opus
  // (legacy path) or stray Haiku drift (tiered path) can't flatten the
  // buckets back into a mixed list.
  if (structuredAssessmentText) {
    for (const id of allIds) {
      const role = classifySection(sectionLabels[id], sectionContexts?.[id]);
      if (role === "assessment") {
        sectionContents[id] = structuredAssessmentText;
      }
    }
  }

  // Pass 2.1 — Defensive PHI scrub on generated output. Even though
  // input was scrubbed (Pass 1.1), the LLM might reconstruct PHI from
  // partial clues. Re-apply scrubPhi to each section value.
  // Always runs — birth numbers, phones, emails are pattern-matched
  // regardless of whether patient name/id are known.
  for (const id of allIds) {
    if (sectionContents[id]) {
      sectionContents[id] = scrubPhi(
        sectionContents[id],
        patientName,
        patientId,
      ).scrubbed;
    }
  }

  // Pass 2.2 — Sanity gate. Runs AFTER PHI scrub so it can:
  //   1. enforce section content routing (formerly Pass C),
  //   2. strip lines that became entirely PHI tokens after scrubbing
  //      (e.g. "[ADDRESS] (14:02)" in a vitals block),
  //   3. flag empty critical sections (Assessment with no content when
  //      diagnosis facts were validated),
  //   4. act as a safety net for impossible measurements that slipped
  //      through fact validation.
  // The gate never throws — the returned report is surfaced to the caller
  // via the `sanityReport` field of this function's return value so the
  // API layer can log / display warnings.
  const gate = runSanityGate({
    sectionContents,
    sectionLabels,
    sectionContexts,
    validatedFacts: validatedFacts
      ? {
          diagnoses: validatedFacts.diagnoses,
          medications: validatedFacts.medications,
        }
      : undefined,
    icdBlock: preRenderedIcdBlock,
    runContentRouting: true,
  });
  for (const id of allIds) {
    sectionContents[id] = gate.contents[id] ?? sectionContents[id];
  }
  const sanityReport = gate.report;

  // Pass 2.3 — Section-target purity. Strips lines that landed in the
  // WRONG section's renderer output (e.g. HPI narrative in LA,
  // structured-assessment headings in EKG, raw vitals lines in Záver,
  // CSV debris anywhere). Operates per-line so legitimate content is
  // preserved; violations are surfaced on the sanity report for
  // observability.
  const purity = enforceSectionPurity(
    sectionContents,
    sectionLabels,
    sectionContexts,
  );
  for (const id of allIds) {
    sectionContents[id] = purity.contents[id] ?? sectionContents[id];
  }
  if (purity.violations.length > 0) {
    logger.debug(
      `[section-purity] stripped ${purity.violations.length} line(s) from mis-routed sections`,
      purity.violations.slice(0, 10).map((v) => ({
        sectionId: v.sectionId,
        role: v.role,
        reason: v.reason,
      })),
    );
    // Surface in the sanity report as warnings so the API layer can log / UI.
    for (const v of purity.violations) {
      sanityReport.warnings.push({
        code: "misrouted_content_stripped",
        severity: "warning",
        sectionId: v.sectionId,
        message: `Section-purity: stripped "${v.reason}" from "${sectionLabels[v.sectionId] ?? v.sectionId}".`,
        detail: v.snippet,
      });
    }
  }

  if (sanityReport.errors.length > 0 || sanityReport.warnings.length > 0) {
    logger.debug(
      `[sanity-gate] ${sanityReport.errors.length} error(s), ${sanityReport.warnings.length} warning(s), ${sanityReport.interventions.length} intervention(s)`,
      {
        errors: sanityReport.errors.map((e) => ({
          code: e.code,
          sectionId: e.sectionId,
        })),
        warnings: sanityReport.warnings.map((w) => ({
          code: w.code,
          sectionId: w.sectionId,
        })),
      },
    );
  }

  // Extract the ICD codes that actually appear in the generated report.
  // This becomes the source of truth for the sidebar `candidateIcdCodes`,
  // replacing the Pass-1 Haiku list which was only a hint to Opus.
  let extractedIcdCodes = extractIcdCodesFromSections(
    sectionContents,
    language,
  );

  // Pass 2.5 — Defensive certainty enforcement. Pass 1.7 already filtered
  // the candidate list before sending it to Opus, and the system prompt
  // forbids inventing codes. Belt-and-braces: if Opus ignored the prompt
  // and emitted a code that isn't in the pre-filtered candidate set, strip
  // it from both the sidebar list AND the rendered section text. This is
  // the second gate that makes the final ICD set deterministic regardless
  // of LLM sampling drift.
  if (clinicalAnalysis) {
    const allowedCodes = new Set(
      clinicalAnalysis.candidateIcdCodes.map((c) => c.code),
    );
    const disallowed = extractedIcdCodes.filter(
      (c) => !allowedCodes.has(c.code),
    );
    if (disallowed.length > 0) {
      logger.warn(
        `[generate] Defensive ICD filter — stripping ${disallowed.length} ungrounded code(s) Opus emitted despite prompt: ${disallowed.map((c) => c.code).join(", ")}`,
      );
      extractedIcdCodes = extractedIcdCodes.filter((c) =>
        allowedCodes.has(c.code),
      );
      // Strip the offending lines from the section text. We use the same
      // line-anchored regex as `extractIcdCodesFromSections` and resolve
      // each match through the CSV so `I210` and `I21.0` collapse to the
      // same canonical code before the allow-list check.
      const stripRegex =
        /^(\s*[-•*]?\s*)([A-Z]\d{2}(?:\.\d{1,4})?)\s+([^\n]*)$/gm;
      for (const id of allIds) {
        const text = sectionContents[id];
        if (!text) continue;
        sectionContents[id] = text.replace(
          stripRegex,
          (line, _bullet, code) => {
            const [resolved] = resolveIcdCodes([code], language);
            if (resolved?.found && !allowedCodes.has(resolved.code)) {
              return ""; // drop the entire line
            }
            return line;
          },
        );
        // Collapse the blank lines we just left behind so the rendered
        // HTML doesn't grow gaps.
        sectionContents[id] = sectionContents[id]
          .replace(/\n{3,}/g, "\n\n")
          .replace(/^\n+/, "")
          .replace(/\n+$/, "");
      }
    }
  }

  // Dedicated title generation — temperature 0, input = extracted ICDs only.
  // Overrides the title from the main Opus call because the main call was
  // prone to hallucinating details (e.g. "lateral wall" when the actual ICD
  // was anterior). Falls back gracefully if the Haiku call fails or returns
  // an empty string.
  const titleFromIcd = await generateEncounterTitle(
    extractedIcdCodes,
    language,
    ctx,
  );
  const finalTitle = titleFromIcd || extractedIcdCodes[0]?.description || "";

  const generatedNote = buildTemplateHtml(
    template,
    sectionContents,
    sectionLabels,
  );

  return {
    generatedNote,
    suggestedTitle: finalTitle,
    extractedIcdCodes,
    systemPrompt,
    userMessage,
    sanityReport,
  };
}
