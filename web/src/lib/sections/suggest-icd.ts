/**
 * ICD-10 suggestion pass — runs ONCE after the note is fully generated.
 *
 * Separate from the `icd-validator` reconciler (which hard-filters the
 * Záver section inline). This pass widens the net: ask Haiku for 10–15
 * candidate codes for the whole encounter, including ones that didn't
 * make the primary Záver but are plausibly in scope (e.g. every chronic
 * condition in OA, every surgery as a `Z87.x`, every imaging finding
 * that warrants a code). The doctor picks which ones to include from
 * the right-side ICD panel.
 *
 * Returns codes in WHO Slovak format. Validates every code against the
 * Slovak CSV before shipping — unknown codes are dropped.
 */
import Anthropic from "@anthropic-ai/sdk";
import { logUsage, type UsageContext } from "../usage";
import { getIcdDescription } from "../lookup/icd";
import { logger } from "../logger";
import type { Language, RawSource, RenderedSection } from "./section-agent";

export interface SuggestedIcdCode {
  code: string;
  description: string;
  confidence?: "high" | "medium" | "low";
  /**
   * Differential-diagnosis clause for a SYMPTOM-code primary (e.g.
   * `R07.4 Bolesť v hrudníku` needs `(diferenciálna dg.: nemožno
   * vylúčiť NSTEMI)`). Populated only when the primary is a symptom
   * code and the source names candidates awaiting work-up. Verbatim
   * Slovak phrasing from the source.
   */
  differential?: string;
}

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

/**
 * Ask Haiku for 10–15 candidate ICD-10 codes covering the full encounter
 * (active diagnoses, chronic comorbidities, notable findings, states-post).
 * Each code is CSV-validated before return — unknown-to-CSV codes are
 * dropped silently. Returns at most 15 valid suggestions.
 */
export async function suggestIcdCodes(
  source: RawSource,
  sections: RenderedSection[],
  language: Language = "sk",
  usage?: UsageContext,
): Promise<SuggestedIcdCode[]> {
  const hasSections = sections.some((s) => s.content.trim());
  const noteDump = hasSections
    ? sections
        .filter((s) => s.content.trim())
        .map((s) => `## ${s.title}\n${s.content.trim()}`)
        .join("\n\n")
    : "";

  const sourceDump = [
    source.transcript ? `# Transcript\n${source.transcript.trim()}` : "",
    source.doctorNotes ? `# Doctor notes\n${source.doctorNotes.trim()}` : "",
    ...(source.files ?? []).map((f) => `# File: ${f.name}\n${f.text.trim()}`),
  ]
    .filter(Boolean)
    .join("\n\n");

  const systemPrompt = `You are an ICD-10 coding assistant for a ${LANGUAGE_LABEL[language]}-language clinical note. Propose 10–15 candidate ICD-10 codes the physician may want to attach to this encounter. Your output ALSO feeds the Záver section — so the primary and its differential (if any) need to be correct.

# Scope
Include candidates for:
- The primary encounter diagnosis.
- Every chronic comorbidity documented in OA / the patient's history.
- Every surgery / procedure in the patient's history ("stav po …") with its Z87.x code.
- Explicit new diagnoses made in THIS encounter (e.g. novodiagnostikované SZpEF).
- Notable imaging or lab findings ONLY when the clinician wrote them as a diagnosis in the source.

# Primary + differential
- The FIRST code is the primary diagnosis driving this encounter. Order matters.
- If the primary is a SYMPTOM code (R07.4 Bolesť v hrudníku, R06.0 Dyspnoe, R50.9 Horúčka, etc.) awaiting work-up, add a \`differential\` field with the verbatim Slovak "nemožno vylúčiť …" clause from the source (e.g. "nemožno vylúčiť NSTEMI, nestabilnú angínu pectoris"). Do NOT add a differential on chronic/established diagnoses.

# Format (HARD)
- WHO Slovak ICD-10 only: \`Letter + 2 digits\` + optional \`.digit\` or \`.digit-digit\`.
- REJECT ICD-10-CM codes with 3+ digits after the decimal (Z87.891, I71.20 — not valid).
- Pick the MOST SPECIFIC matching subcode. \`CKD G3a\` → \`N18.31\` (or \`N18.3\` if N18.31 isn't in the CSV), never \`N18.9\`.
- If unsure of the exact subcode, use the 3-char root (I25 instead of guessing I25.99).

# No fabrication
- Never propose a code for a condition the patient denied.
- Never propose a code derived from a raw imaging/lab finding the clinician didn't diagnose.

# Output
Return ONLY valid JSON, no prose. Shape:
\`\`\`json
{
  "codes": [
    { "code": "R07.4", "description": "Bolesť v hrudníku, bližšie neurčená", "confidence": "high", "differential": "nemožno vylúčiť NSTEMI" },
    { "code": "I10", "description": "Primárna [esenciálna] artériová hypertenzia", "confidence": "high" },
    ...
  ]
}
\`\`\`
- Order by clinical relevance: primary first, chronic comorbidities next, states-post last.
- Confidence: "high" = explicitly diagnosed in source; "medium" = strongly implied; "low" = plausible but less certain.
- 10–15 codes total. If the encounter is genuinely simple, fewer is fine.
- Omit \`differential\` unless the primary is a symptom code.`;

  const userMessage = hasSections
    ? `# Generated note\n${noteDump}\n\n# Raw source\n${sourceDump}`
    : `# Raw source\n${sourceDump}`;

  try {
    const response = await client().messages.create({
      model: MODEL_ID,
      max_tokens: 2000,
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
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn("[suggest-icd] no JSON in response");
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      codes?: Array<{
        code?: string;
        description?: string;
        confidence?: string;
        differential?: string;
      }>;
    };
    const rawCodes = parsed.codes ?? [];

    // CSV-validate every code. Unknown codes → drop.
    const valid: SuggestedIcdCode[] = [];
    for (const c of rawCodes) {
      if (!c.code || !c.description) continue;
      const code = c.code.trim();
      const canonical = getIcdDescription(code, language);
      if (!canonical) {
        logger.debug(`[suggest-icd] drop unknown code ${code}`);
        continue;
      }
      valid.push({
        code,
        description: canonical,
        confidence: normalizeConfidence(c.confidence),
        differential:
          typeof c.differential === "string" && c.differential.trim()
            ? c.differential.trim()
            : undefined,
      });
      if (valid.length >= 15) break;
    }

    return valid;
  } catch (err) {
    logger.error("[suggest-icd] failed:", err);
    return [];
  }
}

function normalizeConfidence(
  raw: string | undefined,
): "high" | "medium" | "low" | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (lower.includes("high")) return "high";
  if (lower.includes("medium") || lower.includes("mod")) return "medium";
  if (lower.includes("low")) return "low";
  return undefined;
}
