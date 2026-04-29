/**
 * Critic pass — Stage 2 of the per-section pipeline, opt-in.
 *
 * For sections where invention/omission bite hardest (HPI/TO, Záver,
 * OA), a second Haiku call audits the draft against the raw source:
 *
 *   1. Remove any claim in the draft that isn't in the source.
 *   2. Add any source fact that belongs in this section but is missing.
 *   3. Preserve the draft's voice / ordering / format — correct, don't
 *      rewrite. If the draft is already faithful and complete, return
 *      it unchanged.
 *
 * One prompt template, parameterised per section. Symmetric input with
 * the author pass (same source, same section.context), plus the
 * author's draft. Haiku, temperature 0. No JSON — returns corrected
 * text directly.
 *
 * Opt-in via `section.critic = true` on the template — structural
 * sections (Vitals, BMI, Výška) don't need it and the extra call just
 * adds noise on single-value extractions.
 */
import { resolve, type SystemBlock } from "../models";
import { logUsage, type UsageContext } from "../usage";
import type { Language, RawSource } from "./section-agent";
import type { NoteSkeleton } from "./note-skeleton";
import { formatSkeletonBlock } from "./note-skeleton";

/** Model tier for the critic pass. Haiku is the default everywhere —
 *  verification is a simpler task than generation. */
export type CriticModel = "haiku" | "sonnet";

const LANGUAGE_LABEL: Record<Language, string> = {
  sk: "Slovak",
  cs: "Czech",
  en: "English",
};

export interface CriticInput {
  /** The author's draft — what renderSection produced (or, for Záver,
   *  the suggester's formatted output). */
  draft: string;
  source: RawSource;
  sectionId: string;
  sectionTitle: string;
  sectionContext: string;
  language: Language;
  usage?: UsageContext;
  /** Model tier for this critic call. Defaults to haiku. */
  model?: CriticModel;
  /**
   * Template-wide guardrails — admin-editable worldview the author was
   * required to follow. When present, the critic sees this so it
   * preserves voice/conventions instead of stripping them as "invention".
   * Same string the author saw (template.systemPrompt).
   */
  templateSystemPrompt?: string;
  /**
   * Voice examples the author was shown for THIS section (from the
   * template's reference corpus). The critic uses these to recognise
   * legitimate voice/structure — not as content to copy. Source still
   * wins when source and voice conflict.
   */
  sectionExamples?: string[];
  /**
   * Shared encounter skeleton (chief complaint, encounter type, key
   * dates, providers, critical findings). Same value the renderer saw.
   * Propagated so the critic has the same cross-section context and
   * doesn't strip skeleton-anchored facts as "invention". Source
   * remains the source of truth when skeleton and source conflict.
   */
  skeleton?: NoteSkeleton | null;
}

export interface CriticResult {
  /** Corrected content. Identical to input when nothing needed changing. */
  content: string;
  changed: boolean;
  /** One-line human-readable summary for logs. */
  diffSummary: string;
}

export async function criticPass(input: CriticInput): Promise<CriticResult> {
  const draft = input.draft.trim();
  if (draft.length === 0) {
    return { content: input.draft, changed: false, diffSummary: "empty" };
  }

  const systemBlocks = buildSystemBlocks(input);
  const userMessage = buildUserMessage(input, draft);
  const tier = input.model ?? "haiku";
  const provider = resolve("critic", tier);

  // Structured output via tool-use — forces the model to return the
  // corrected text inside a single string field. No essay-leak is
  // possible because the response body is a tool call, not free prose.
  // If the correct output is empty, the model passes an empty string.
  const result = await provider.generate({
    maxTokens: 2000,
    temperature: 0,
    system: systemBlocks,
    user: userMessage,
    tool: {
      name: "submit_corrected_section",
      description:
        "Submit the corrected section text. Return an empty string when nothing survives the audit.",
      schema: {
        type: "object",
        properties: {
          corrected: {
            type: "string",
            description:
              "The verbatim corrected section body that belongs in the note. Empty string when the section should be empty.",
          },
        },
        required: ["corrected"],
      },
    },
  });

  if (input.usage) {
    logUsage({
      userId: input.usage.userId,
      visitId: input.usage.visitId,
      provider: provider.name,
      model: provider.model,
      operation: "generate_section",
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheCreationInputTokens: result.usage.cacheCreationTokens,
      cacheReadInputTokens: result.usage.cacheReadTokens,
    });
  }

  const corrected =
    typeof result.toolInput?.corrected === "string"
      ? (result.toolInput.corrected as string).trim()
      : "";

  const changed = corrected !== draft;
  const diffSummary = changed
    ? `len ${draft.length}→${corrected.length}`
    : "no change";
  return { content: corrected, changed, diffSummary };
}

// ─── Prompt assembly ──────────────────────────────────────────────────

/**
 * Build the critic's system prompt as an array of blocks with explicit
 * prompt-cache breakpoints. Layout:
 *
 *   block 1 — ROLE + all hard rules (cache: true)
 *     Locale-specific but otherwise invariant across every critic call.
 *     Bulk of input tokens live here (~3–4 KB of rule tables).
 *
 *   block 2 — TEMPLATE GUARDRAILS (cache: true)
 *     Added only when the caller passes `templateSystemPrompt`. One
 *     cache entry per unique template.systemPrompt. Gives the critic
 *     voice/worldview awareness the author already had.
 *
 *   block 3 — PER-SECTION (uncached)
 *     Voice examples + the section contract. Varies per section.
 */
export function buildSystemBlocks(input: CriticInput): SystemBlock[] {
  const localeLabel = LANGUAGE_LABEL[input.language];
  const blocks: SystemBlock[] = [];

  // ── block 1: ROLE + all hard rules (cached) ──
  blocks.push({ text: buildRuleBlock(localeLabel), cache: true });

  // ── block 2: TEMPLATE GUARDRAILS (cached; only when present) ──
  const guardrails = input.templateSystemPrompt?.trim();
  if (guardrails) {
    blocks.push({
      text: `# Template-wide guardrails (the author was required to follow these — preserve this voice when the content is grounded in source; if voice and source conflict, source wins)\n${guardrails}`,
      cache: true,
    });
  }

  // ── block 3: PER-SECTION (uncached) ──
  blocks.push({ text: buildPerSectionBlock(input) });

  return blocks;
}

/** Per-section tail of the critic system prompt. Varies per call. */
function buildPerSectionBlock(input: CriticInput): string {
  const examplesBlock =
    input.sectionExamples && input.sectionExamples.length > 0
      ? `# Voice examples for "${input.sectionTitle}" (from the template's reference corpus — style references, NOT content to copy)\nRecognise these as the author's expected voice/structure. Do NOT strip the draft's adherence to this style as "invention". If the source contradicts the style, source wins.\n\n${input.sectionExamples
          .map((ex, i) => `Example ${i + 1}:\n${ex}`)
          .join("\n\n")}\n\n`
      : "";

  return `${examplesBlock}# Current section
You are auditing "${input.sectionTitle}". Apply the rules above to THIS section's draft only.

# Section contract (what THIS section OWNS and EXCLUDES)
${input.sectionContext}`;
}

function buildRuleBlock(localeLabel: string): string {
  return `# Role
You audit a draft clinical-note section in ${localeLabel} against the raw source. You RETURN the corrected section text — not a diff, not commentary.

# Check exactly two things
1. INVENTION — any fact, number, name, drug, diagnosis, or wording in the draft that is NOT traceable to the raw source below. Remove it. Clinical-sounding sentences that look plausible but aren't grounded in this specific source ARE invention — do not be charitable.
2. OMISSION — any fact in the source that belongs in this section (per the contract below) but is missing from the draft. Add it, formatted consistently with the draft's existing style.

## Legitimate transformations (keep these)
- **Number-word → digit conversion**: if the patient said "sto tridsaťpäť" / "stotridsaťpäť" and the draft writes "135", KEEP it. Source-transcripts are spoken Slovak and often use word-form numbers. "sedemdesiatpäť" = 75. "stošesťdesiatpäť" = 165. "osemdesiatdva" = 82. "dvanásť" = 12. The draft is allowed to normalise these to digits.
- **Unit normalisation**: "sto tridsaťpäť na osemdesiatdva" → "135/80 mmHg" is fine when the context is a blood pressure reading.
- **Abbreviation expansion / contraction** ("stp." ↔ "stav po", "DK" ↔ "dolné končatiny") is fine when both forms refer to the same finding.
- **Reordering / punctuation / formatting** is fine — only the FACTS need to match.

## Clinical paraphrasing (HARD RULE — keep normal speech→note translations)
Transcripts are SPOKEN Slovak — patients and doctors use colloquial, incomplete, or fragmented phrasing that a doctor routinely rewrites in proper clinical form. The draft is allowed (and expected) to do the same rewrite. Do NOT strip a phrase as "invention" just because the exact wording isn't in the source — only strip when the underlying FACT isn't there.

Standard paraphrases that are always legitimate, do NOT remove them:
- Informal / incomplete illness term → formal one, when context disambiguates:
  - "na mozgovú" / "mozgovú mŕtvicu" / "mozgovú cievu sa upchala" → **mozgovú príhodu** / **CMP**
  - "srdcový záchvat" / "zomrel na srdce" → **infarkt myokardu** / **kardiálna príčina**
  - "cukrovka" → **diabetes mellitus**
  - "vysoký tlak" → **hypertenzia** / **arteriálna hypertenzia**
  - "slabé srdce" / "vodu v pľúcach" → **zlyhávanie srdca**
- Person / tense normalisation (1st person patient speech → 3rd person clinical):
  - "mám bolesti" → "udáva bolesti" / "má bolesti"
  - "beriem X" → "užíva X"
  - "ja sa o ňu starám" → "stará sa o matku" (preserve the verb where natural)
- Filler removal: "viete čo, no hej, tak" — drop; only the clinical content stays.
- Conservative completion of fragmented phrases: "otec ... na mozgovú ..." + later "cieva sa upchala" → "otec zomrel na mozgovú príhodu". Complete when the source signals the fact even if not spelled out in one span.

Prefer the STANDARD clinical term over an over-literal transcription. "Otec zomrel na mozgovú cievu" is grammatically wrong Slovak — "mozgovú príhodu" or "CMP" is the correct form. If the draft gets too literal and produces ungrammatical Slovak, REWRITE to the clinical-standard form. That is correction, not invention.

## Unfounded denials — STRIP (silence ≠ denial) — GLOBAL HARD RULE
This rule is SECTION-AGNOSTIC and OVERRIDES the section contract. It applies in every section: RA, OA, SA, EA, PA, AA, LA, Ab, TO, Krvný tlak, Pulz, Výška, Hmotnosť, BMI, Celkové vyšetrenie, EKG, Záver, Postup a plán — without exception.

A "X neguje" / "X nemá" / "bez X" / "X nepije" / "X nefajčí" clause (anywhere in any section) is a CLAIM about the patient: that they explicitly denied X, OR that X was explicitly examined and found absent. That claim NEEDS source backing. The source must contain ONE of:
- an explicit verbal denial from the patient ("Nie, drogy neberiem" / "Nepijem" / "Nemám alergie") — actually in the transcript,
- an explicit Q&A where the doctor asked and the patient answered negatively ("— Pijete alkohol?" — "Nie."), or
- (for physical findings) an explicit dictated absence ("nohy neopuchajú" / "bez edémov DK" — actually said by the doctor in the source).

If the source is SILENT on a topic, we CANNOT assert the patient denied it — not even when the section contract lists "X neguje" as an allowed output pattern. Silence never means "the patient denied"; it means "we don't know, so the note must not say". Contracts that suggest otherwise are OVERRIDDEN by this rule.

Concrete examples of unfounded denials to STRIP when the source is silent on the topic:
- "Alkohol neguje" / "Alkohol nepije" — source never discusses alcohol → STRIP
- "Drogy neguje" — source never discusses drugs → STRIP
- "Infekčné ochorenie neguje" — source never discusses infectious exposure → STRIP
- "Akútne negat." / "akútne negat" / "akútne negatívne" — catch-all denial for acute presentation in the section (most common in EA). Requires source to contain an explicit acute-denial question/answer (e.g. doctor asks "nejaká infekcia, virus?", patient answers "nie"). If source is silent → STRIP.
- "Očkovania aktuálne neguje" — source never asks about vaccination → STRIP
- "Cestovanie neguje" — source never asks about travel → STRIP
- "Alergiu na lieky neguje" — source never discusses drug allergies → STRIP
- "Alergia na kontrastné látky neguje" — source never mentions contrast media → STRIP
- "Bez edémov DK" — source has no lower-extremity dictation → STRIP
- "Kontakt s infekčnou osobou neguje" — source never discusses contact history → STRIP
- "Bušenie srdca neguje" / "synkopy neguje" — source never asks about these symptoms → STRIP
- "Bez ťažkostí" / "Bez sťažností" / "Akútne bez zmien" — catch-all "everything fine" filler. Requires source to have an explicit negation for the context. Silent source → STRIP.

Partial denials are fine. If the source discussed smoking but not alcohol, keep only "Nefajčí." and do NOT pad with "Alkohol neguje. Drogy neguje." If the source discussed drug allergies but not contrast media, keep only "Alergiu na lieky neguje." and drop "KL" from that clause.

## Catch-all denials are claims too
Short, idiomatic catch-alls like "akútne negat.", "bez ťažkostí", "bez zmien", "v norme", "bpn." (bez patologického nálezu) are still CLAIMS that the patient / doctor asserted absence. They need the same source backing as longer denials. Short doesn't mean exempt — the entire section should return empty if the source is silent.

If AFTER stripping unfounded denials the entire section would be empty, return an empty string (zero characters). An empty EA is correct when the source has no epidemiological content; an empty Ab is correct when the source only discussed smoking and you stripped everything else down to one line. Empty is ALWAYS safer than unfounded.

# HARD RULE: no examples, no training-data fillers
The author may have had access to voice examples from OTHER patients. Any sentence from those examples that happens to appear in THIS draft but is not backed by THIS source is invention. Same for stock clinical boilerplate you might recall from training data.

Common boilerplate traps — if any of these appears in the draft and is NOT echoed in the source, REMOVE it:
- "Pacient(ka) pri vedomí, orientovaný(á)" / "GCS 15"
- "Habitus štíhly" / "Habitus obézny" / "Habitus primeraný"
- "Dýchanie vezikulárne bilat." / "Dýchanie čisté" / "Dýchanie bez ráz" / "Eupnoe"
- "Srdcové tóny pravidelné, bez šelestov" / "Ozvy ohraničené" / "Cor AP"
- "Abdomen mäkký, priehmatný, nebolestivý"
- "Dolné končatiny bez edémov" / "DK bez edémov, pulzácie hmatám do periférie"
- "Neurologický nález v norme" / "Bez ložiskových nálezov"
- "Koža bez ikteru a cyanózy" / "Kapilárny návrat pod 2 sekundy"
- "SR 72/min, QRS 96 ms, QTc 421 ms" (or any EKG interval combination not matching the source)

If the source does not contain the corresponding finding (exact wording or a clear equivalent), these sentences MUST be stripped. It is safer to leave a section partly empty than to keep a plausible-sounding but ungrounded sentence.

# Preserve the draft
Keep the author's voice, ordering, format, and connective tissue ("pred dvoma dňami", "včera", "preto", "následne", "bez ďalších ťažkostí") when those words come from the source. If they don't appear in the source AND they only carry stylistic filler, remove them too.
Keep negations and differential phrasing ("neguje", "bez edémov", "nemožno vylúčiť …") exactly as the author wrote them — BUT only when the source contains the corresponding negation / differential statement. Don't keep "neguje" clauses if nothing in the source reflects that denial.

Correct; do NOT rewrite for aesthetic reasons.

# If already correct
If every clause in the draft is already grounded in the source AND the contract is satisfied, return it UNCHANGED, byte-for-byte.

# If nothing survives
If, after removing ungrounded content, nothing remains that satisfies the contract, pass an EMPTY STRING to the \`corrected\` field. Do NOT write reasoning, explanations, placeholders ("(empty)", "žiadne údaje"), or any text commentary — return an empty string and move on.

# Output
You MUST respond by calling the \`submit_corrected_section\` tool with the corrected section body in its \`corrected\` field. Plain ${localeLabel} text. NO markdown wrappers, NO headings, NO section labels — just the body text. If the section should be empty, pass "".`;
}

function buildUserMessage(input: CriticInput, draft: string): string {
  const parts: string[] = [];

  // Shared encounter skeleton (same one the renderer saw). Placed
  // BEFORE the raw source so the auditor has the cross-section picture
  // the renderer had. Source still wins when the two disagree.
  if (input.skeleton) {
    parts.push(
      `# Shared encounter context (pre-computed hint — source is TRUTH when they conflict)\n${formatSkeletonBlock(input.skeleton)}`,
    );
  }

  const sourceBlock = buildSourceBlock(input.source);
  if (sourceBlock) parts.push(sourceBlock);

  parts.push(`# Current "${input.sectionTitle}" draft\n${draft}`);

  return parts.join("\n\n");
}

function buildSourceBlock(source: RawSource): string {
  const parts: string[] = [];
  if (source.transcript?.trim()) {
    parts.push(`## Transcript\n${source.transcript.trim()}`);
  }
  if (source.doctorNotes?.trim()) {
    parts.push(`## Doctor notes\n${source.doctorNotes.trim()}`);
  }
  for (const file of source.files ?? []) {
    if (!file.text?.trim()) continue;
    parts.push(`## File: ${file.name}\n${file.text.trim()}`);
  }
  if (parts.length === 0) return "";
  return `# Raw source\n\n${parts.join("\n\n")}`;
}
