/**
 * ICD-10 suggestion pass — runs ONCE per generation.
 *
 * Produces 10–15 candidate codes for the encounter based on the raw
 * source. Output feeds BOTH the right-side "Navrhované kódy" panel
 * AND the Záver section (via `formatZaverFromSuggestions`), which
 * then goes through the per-section critic + icd-validator reconciler
 * for correction.
 *
 * Returns codes in WHO Slovak format. Validates every code against the
 * Slovak CSV before shipping — unknown codes are dropped.
 */
import Anthropic from "@anthropic-ai/sdk";
import { logUsage, type UsageContext } from "../usage";
import { getIcdDescription } from "../lookup/icd";
import { logger } from "../logger";
import type { Language, RawSource } from "./section-agent";

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
  language: Language = "sk",
  usage?: UsageContext,
): Promise<SuggestedIcdCode[]> {
  const sourceDump = [
    source.transcript ? `# Transcript\n${source.transcript.trim()}` : "",
    source.doctorNotes ? `# Doctor notes\n${source.doctorNotes.trim()}` : "",
    ...(source.files ?? []).map((f) => `# File: ${f.name}\n${f.text.trim()}`),
  ]
    .filter(Boolean)
    .join("\n\n");

  const systemPrompt = `You are an ICD-10 coding assistant for a ${LANGUAGE_LABEL[language]}-language clinical note. Propose 10–15 candidate ICD-10 codes the physician may want to attach to this encounter. Your output ALSO feeds the Záver section — the primary and any differential need to be correct.

# Transcript primacy for the clinician's own assessment
The \`# Transcript\` block captures what the CLINICIAN said during the encounter — their live clinical judgment. Treat the clinician's own verbalized assessment as GROUND TRUTH and as the ANCHOR for the primary diagnosis and anatomy.

Hallmark phrasing that signals the clinician's assessment (not the patient speaking):
- "vyzerá to na …" / "vyzerá na …" ("looks like …")
- "je to …" / "jedná sa o …" / "bude to …"
- "na EKG to vyzerá na stemy/NSTEMI/…"
- "myslím, že …" / "ide o …" / "svedčí to pre …"

When the clinician specifies ANATOMY, SUBTYPE, or SEVERITY ("stemy laterálnej steny", "paroxyzmálna fibrilácia", "stredne závažná mitrálna regurgitácia") — use their wording EXACTLY. It overrides tentative OCR wording ("difdg.", "možná", "vs.") because the transcript reflects the clinician's current judgment after seeing today's data.

# MI anatomy — cross-check with EKG before coding
If the primary is an acute MI, the ICD site code MUST match both the clinician's named anatomy AND the EKG findings in the source. Slovak WHO ICD-10 MI codes (note that I21.2 covers lateral, apical, high-lateral sites — its CSV description "na iných miestach" / "on other sites" is the catch-all for non-anterior/non-inferior STEMI):
- **I21.0** — transmurálny infarkt PREDNEJ steny. EKG: ST elevation V1–V4.
- **I21.1** — transmurálny infarkt SPODNEJ steny (inferior). EKG: ST elevation II, III, aVF.
- **I21.2** — transmurálny infarkt NA INÝCH MIESTACH (lateral, apical, high-lateral, posterolateral). EKG: ST elevation in I, aVL, V5–V6 — typically with reciprocal ST depression in III, aVF, V1.
- **I21.4** — subendokardiálny infarkt (NSTEMI): troponin positive WITHOUT ST elevation.
- **I21.9** — bližšie neurčený: LAST RESORT only when neither anatomy nor ST elevation is documented. Never use as a shortcut when the source gives you enough information to pick I21.0–I21.4.

Example: clinician says "stemy laterálnej steny" AND EKG shows "ST elev. aVL, I, depr. ST III, aVF, V1" → \`I21.2\` (lateral STEMI). NEVER \`I21.0\` (anterior) — aVL/I are lateral leads, not anterior. NEVER \`I21.9\` — the source gave you the anatomy and the ST pattern.

# Tobacco use in cardiology notes
Long-term active smoking with daily pack-count ("fajčiar pätnásť cigariet denne", "dlhoročný fajčiar") is routinely coded in Slovak cardiology as **F17.2** (Porucha psychiky a správania zapríčinená užívaním tabaku: syndróm závislosti). Include F17.2 when the patient reports established daily smoking, not just occasional.

# Anatomy, severity, subtype, etiology — specificity matters
The source's exact wording drives the code. Common traps to avoid:
- "mitrálna regurgitácia" → I34.x (mitral). NEVER I35.x (aortic).
- "paroxyzmálna fibrilácia predsiení" → I48.0 (paroxysmal). NEVER I48.1 (persistent).
- "AV blok 1. stupňa" → I44.0 (first degree). NEVER I44.1 (second degree).
- "st.p. strumektómii, na terapii Euthyroxom" → E89.0 (post-surgical hypothyroidism). NEVER E03.2 (drug-induced).
- "st.p. operácii katarakty" → Z96.1 or omit. NEVER H26.9 (active cataract).
If the source denies or negates a finding, do NOT emit a code for it.

# Scope
Include candidates for:
- The primary encounter diagnosis.
- Every chronic comorbidity documented in OA / the patient's history.
- Every surgery / procedure in the patient's history ("stav po …") with its Z87.x code.
- Explicit new diagnoses made in THIS encounter (e.g. novodiagnostikované SZpEF).
- Notable imaging or lab findings ONLY when the clinician wrote them as a diagnosis.

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
- Confidence: "high" = explicitly diagnosed; "medium" = strongly implied; "low" = plausible but less certain.
- 10–15 codes total. If the encounter is genuinely simple, fewer is fine.
- Omit \`differential\` unless the primary is a symptom code.`;

  const userMessage = `# Raw source\n${sourceDump}`;

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

    // CSV-validate every code. Unknown codes → drop. Duplicate codes
    // (Haiku likes proposing catch-all Z87.8 twice for two different
    // "st.p." items) → keep the first occurrence only; downstream UI
    // uses `code` as React key and crashes on collisions.
    const valid: SuggestedIcdCode[] = [];
    const seen = new Set<string>();
    for (const c of rawCodes) {
      if (!c.code || !c.description) continue;
      const code = c.code.trim();
      if (seen.has(code)) {
        logger.debug(`[suggest-icd] drop duplicate code ${code}`);
        continue;
      }
      const canonical = getIcdDescription(code, language);
      if (!canonical) {
        logger.debug(`[suggest-icd] drop unknown code ${code}`);
        continue;
      }
      seen.add(code);
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
