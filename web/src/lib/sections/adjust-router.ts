/**
 * Adjust router — a one-shot Haiku classifier that decides which
 * template sections a mid-visit "adjustment" (new dictation + new
 * files) should re-render.
 *
 * Input: the full leaf-section list (id + label + one-line contract
 * hint) plus the delta text (adjustmentTranscript + newFileTexts).
 * Output: a subset of section ids that are plausibly affected.
 *
 * Rule of thumb: prefer precision over recall — returning too many ids
 * is cheap (extra Haiku calls, but correct output), returning too few
 * risks a section reflecting stale content. The prompt biases the
 * model toward inclusion when the delta is ambiguous.
 */
import Anthropic from "@anthropic-ai/sdk";
import { logUsage, type UsageContext } from "../usage";
import { logger } from "../logger";
import type { Language } from "./section-agent";

const MODEL_ID = "claude-haiku-4-5-20251001";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ maxRetries: 2 });
  return _client;
}

const LANGUAGE_LABEL: Record<Language, string> = {
  sk: "Slovak",
  cs: "Czech",
  en: "English",
};

export interface AdjustRouterSection {
  id: string;
  label: string;
  /** Short description of what the section owns — the first line or
   *  two of the section.context is enough. */
  contractHint: string;
}

export interface AdjustRouterInput {
  sections: AdjustRouterSection[];
  adjustmentTranscript?: string;
  newFileTexts?: Array<{ name: string; text: string }>;
  language?: Language;
  usage?: UsageContext;
}

/**
 * Return the subset of section ids whose content is plausibly affected
 * by the delta. Falls back to "all section ids" on any error — safer
 * to re-render everything than to miss something.
 */
export async function routeAdjustment(
  input: AdjustRouterInput,
): Promise<{ affectedSectionIds: string[]; reasoning?: string }> {
  const { sections, adjustmentTranscript, newFileTexts, usage } = input;
  const language = input.language ?? "sk";
  const allIds = sections.map((s) => s.id);

  const deltaBody = [
    adjustmentTranscript?.trim()
      ? `# Adjustment transcript\n${adjustmentTranscript.trim()}`
      : "",
    ...(newFileTexts ?? []).flatMap((f) =>
      f.text.trim() ? [`# New file: ${f.name}\n${f.text.trim()}`] : [],
    ),
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!deltaBody) {
    // No delta at all → nothing to re-render.
    return { affectedSectionIds: [] };
  }

  const sectionList = sections
    .map((s) => `- \`${s.id}\` ("${s.label}"): ${s.contractHint}`)
    .join("\n");

  const systemPrompt = `You classify which sections of a ${LANGUAGE_LABEL[language]} clinical note need to be re-rendered after the doctor dictated an adjustment.

# Rules
- Return ONLY valid JSON — no prose, no markdown, no backticks.
- Shape: {"affected": ["sectionId1", "sectionId2", ...], "reasoning": "one-line summary"}
- The \`affected\` array must contain section ids copied VERBATIM from the list provided.
- A section is "affected" when the adjustment introduces content that THAT section OWNS.
- Examples of clear mappings:
    - "TK 135/80" or "tlak sto tridsaťpäť" → Krvný tlak
    - "váha 75 kg" or "sedemdesiatpäť kíl" → Hmotnosť
    - "výška 165 cm" → Výška
    - "pulz 80" or "frekvencia 85" → Pulz
    - "teraz je pacient pri vedomí, dýchanie vezikulárne" → Celkové vyšetrenie
    - "EKG ukazuje fibriláciu predsiení" → EKG
    - "nová anamnéza: diabetes od 2023" → OA
    - "pacient začal brať Concor 5 mg" → LA
    - "dnes ráno bolesť na hrudi ustúpila" → TO
- If the adjustment is ambiguous, INCLUDE the section (bias toward re-rendering).
- If the adjustment mentions nothing relevant, return \`"affected": []\`.
- Záver should be included only when a section that feeds Záver (OA, TO, diagnoses) changes.

# Sections available
${sectionList}`;

  const userMessage = `# Delta to evaluate\n\n${deltaBody}`;

  try {
    const response = await client().messages.create({
      model: MODEL_ID,
      max_tokens: 400,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    if (usage) {
      logUsage({
        userId: usage.userId,
        visitId: usage.visitId,
        provider: "anthropic",
        model: MODEL_ID,
        operation: "clinical_analysis",
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      });
    }

    const text = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      logger.warn("[adjust-router] no JSON in response; falling back to all");
      return { affectedSectionIds: allIds };
    }
    const parsed = JSON.parse(match[0]) as {
      affected?: unknown;
      reasoning?: unknown;
    };
    const affectedRaw = Array.isArray(parsed.affected) ? parsed.affected : [];
    const valid = new Set(allIds);
    const affectedSectionIds = affectedRaw
      .filter((x): x is string => typeof x === "string" && valid.has(x))
      .filter((v, i, arr) => arr.indexOf(v) === i);

    const reasoning =
      typeof parsed.reasoning === "string" ? parsed.reasoning : undefined;
    logger.debug(
      `[adjust-router] affected=${JSON.stringify(affectedSectionIds)} reasoning="${reasoning ?? ""}"`,
    );

    return { affectedSectionIds, reasoning };
  } catch (err) {
    logger.error("[adjust-router] routing failed; falling back to all:", err);
    return { affectedSectionIds: allIds };
  }
}
