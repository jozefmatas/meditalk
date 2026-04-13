import { anthropic } from "../anthropic";
import { logUsage, type UsageContext } from "../usage";
import type { SupportedLanguage } from "../types";
import { extractJson } from "./json-repair";
import { logger } from "@/lib/logger";

/**
 * Pass 1.5 — Structured Fact Extraction.
 *
 * Between Pass 1 (clinical analysis) and Pass 2 (Opus prose generation) we
 * run a cheap Haiku pass that turns the raw source material (transcript +
 * OCR'd files + doctor notes) into a deterministic list of clinical facts,
 * each with a mandatory verbatim evidence quote pointing back at the exact
 * source chunk/file/note. A programmatic validator (see `fact-validator.ts`)
 * then drops any fact whose evidence cannot be found in the referenced
 * source, before the validated set is handed to Opus as the factual
 * contract for the generated report.
 */

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

/** Source material fed into the fact extraction pass. */
export interface FactExtractionInput {
  /** Transcript chunks (ordered, 0-based). */
  chunks: string[];
  /** Free-form doctor notes (single blob). */
  doctorNotes?: string;
  /** OCR'd file content (labs, referrals, etc.), 0-based. */
  files?: { name: string; type: string; text: string; context?: string }[];
}

/** Where in the source material a fact was extracted from. */
export interface SourceReference {
  type: "transcript" | "doctor_notes" | "file";
  /** Index into `chunks` / `files` (doctor_notes is always 0). */
  sourceIndex: number;
  /** Short verbatim quote proving the fact exists in the source. */
  evidence: string;
}

/** A single extracted clinical fact with mandatory source reference. */
export interface ExtractedFact {
  category: FactCategory;
  /** The fact itself in clinical language, short (≤120 chars). */
  value: string;
  source: SourceReference;
}

/** Fact categories, aligned with template section roles. */
export type FactCategory =
  | "demographics"
  | "chiefComplaint"
  | "symptoms"
  | "findings"
  | "measurements"
  | "diagnoses"
  | "medications"
  | "procedures"
  | "history"
  | "plan";

/** Output of Pass 1.5 fact extraction. */
export interface ExtractedFacts {
  demographics: ExtractedFact[];
  chiefComplaint: ExtractedFact[];
  symptoms: ExtractedFact[];
  findings: ExtractedFact[];
  measurements: ExtractedFact[];
  diagnoses: ExtractedFact[];
  medications: ExtractedFact[];
  procedures: ExtractedFact[];
  history: ExtractedFact[];
  plan: ExtractedFact[];
  /** Haiku token usage for this extraction call. */
  usage: { inputTokens: number; outputTokens: number };
}

/** Canonical list of fact categories in schema order. */
export const FACT_CATEGORIES: readonly FactCategory[] = [
  "demographics",
  "chiefComplaint",
  "symptoms",
  "findings",
  "measurements",
  "diagnoses",
  "medications",
  "procedures",
  "history",
  "plan",
] as const;

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: "English",
  sk: "Slovak",
  cs: "Czech",
};

/** Build an empty `ExtractedFacts` skeleton. */
export function emptyExtractedFacts(): ExtractedFacts {
  return {
    demographics: [],
    chiefComplaint: [],
    symptoms: [],
    findings: [],
    measurements: [],
    diagnoses: [],
    medications: [],
    procedures: [],
    history: [],
    plan: [],
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

/**
 * System prompt for the Haiku fact extraction pass.
 * Deliberately strict — the whole point of this pass is to produce a
 * grounded intermediate representation that the prose pass cannot drift
 * away from.
 */
export function buildFactExtractionSystemPrompt(
  language: SupportedLanguage,
): string {
  const langLabel = LANGUAGE_LABELS[language];
  const categoryList = FACT_CATEGORIES.join(", ");

  return `You are a clinical fact extractor. Your ONLY job is to extract facts that are EXPLICITLY stated in the source material and return them as structured JSON.

RULES:
1. Extract ONLY facts that are directly stated in the source. No inference, no assumptions, no "commonly associated" findings, no filling in typical clinical details.
2. Every fact MUST include a source reference with a short VERBATIM evidence quote (≤120 chars) copied from the source material. Quote the exact wording, do not paraphrase.
3. If you cannot find evidence for a fact, do NOT include it. Missing is better than hallucinated.
4. Do NOT interpret, diagnose, or upgrade severity. Extract exactly what is stated. If the source says "ACS", the diagnosis value stays "ACS" — never rewrite to "STEMI" or "non-STEMI".
5. For medications: extract the exact name as mentioned. Include dosage, strength, and frequency only if EXPLICITLY stated in the source.
6. For diagnoses: copy the exact wording. Preserve uncertainty markers like "suspected", "possible", "rule out".
7. For measurements (BP, HR, SpO2, temperature, lab values, weight, height): always include the unit as stated — and ONLY the unit as stated. If the source gives a number without a unit, see rule 13.
8. Facts describing what the doctor or patient PLANS to do (follow-up, prescription, referral, lifestyle change, next visit) go in \`plan\`.
9. Facts describing PAST events (previous surgeries, chronic conditions, family history, prior medications discontinued long ago) go in \`history\`.
10. Write fact \`value\` fields in ${langLabel}. Keep them short (≤120 chars) and clinical — do not write prose sentences.
11. A single source statement may produce multiple facts (one per distinct clinical datum), but the same fact MUST NOT appear in more than one category.
12. EXTRACT EVERY DISTINCT MENTION — do NOT try to resolve self-corrections or contradictions yourself. If the speaker states a fact and then corrects themselves, emit BOTH mentions as separate fact entries, each with its own verbatim evidence quote pointing at the exact source phrase. This applies to EVERY correction shape: explicit phrases ("actually I mean", "sorry", "pardon", "vlastne", "opravujem sa"), bare punctuation-bracketed negations ("otec zomrel na infarkt, nie, na mozgovú mŕtvicu" — "father died of MI, no, of a stroke" — "1 broken rib, sorry, 2 broken ribs"), and any other structural hint that the speaker is replacing an earlier statement. A deterministic downstream step will detect the correction marker and drop the superseded mention. Your job is to be a faithful recorder, not an editor — so ALWAYS extract both the pre-correction value and the corrected value, every single time. Do NOT silently keep only the later one, and do NOT silently keep only the earlier one.
13. NO ASSUMPTION MODE — NEVER invent missing clinical dimensions. If a numeric value is stated WITHOUT a unit or dimension (e.g. "fajčí 15" with no "cigariet/deň" and no "rokov", "pije 3" with no "pohárov/deň", "mal 2" with no indication of what), you MUST preserve the raw value verbatim and MUST NOT guess the unit. Do NOT default to the most common interpretation (smoking 15 ≠ 15/day, smoking 15 ≠ 15 years — both are fabrication). Do NOT silently drop the fact either. Instead, emit a single fact whose \`value\` contains the bare number together with the subject (e.g. "fajčí 15 (jednotka nešpecifikovaná)", "pije 3 (jednotka nešpecifikovaná)"), and whose evidence is the exact verbatim quote. In ${langLabel} use the ambiguity marker "(jednotka nešpecifikovaná)" in Slovak, "(jednotka neuvedena)" in Czech, or "(unit not specified)" in English. The same rule applies to any missing clinical dimension: frequency, duration, laterality, severity, dosage strength, route — if it is not in the source, do NOT invent it.

SOURCE REFERENCE SCHEMA:
Each fact MUST include a \`source\` object with exactly these three fields:
- \`type\`: "transcript" | "doctor_notes" | "file" — MUST match the header label (\`[transcript sourceIndex=N]\`, \`[file sourceIndex=N]\`, \`[doctor_notes sourceIndex=0]\`) under which you found the evidence. Do NOT guess based on how the content "looks" — an audio recording transcribed into a file still belongs to \`file\` if that is how it was presented in the user message.
- \`sourceIndex\`: integer (0-based, taken verbatim from the header label that contains the evidence; \`doctor_notes\` always uses 0)
- \`evidence\`: short verbatim quote from the referenced source (≤120 chars)

CATEGORIES (use exactly these JSON keys, in any order): ${categoryList}

OUTPUT FORMAT:
Return a single valid JSON object with one key per category. Each key maps to an array of fact objects. A category with no facts MUST be an empty array \`[]\`. Do not include keys other than the categories listed above. Do not wrap the JSON in prose or markdown fences.

Each fact object MUST have exactly these keys: \`category\`, \`value\`, \`source\`. The \`category\` field MUST equal the containing key.

EXAMPLE (illustrative only — do not copy the content):
{
  "demographics": [],
  "chiefComplaint": [
    { "category": "chiefComplaint", "value": "bolesť na hrudníku od rána", "source": { "type": "transcript", "sourceIndex": 0, "evidence": "má bolesť na hrudníku od rána" } }
  ],
  "symptoms": [],
  "findings": [],
  "measurements": [
    { "category": "measurements", "value": "TK 150/95 mmHg", "source": { "type": "transcript", "sourceIndex": 0, "evidence": "tlak 150 na 95" } }
  ],
  "diagnoses": [],
  "medications": [],
  "procedures": [],
  "history": [],
  "plan": []
}`;
}

/**
 * User message for fact extraction — numbered source material so the model
 * can reference each piece by index in its `source.sourceIndex` field.
 */
export function buildFactExtractionUserMessage(
  input: FactExtractionInput,
): string {
  const parts: string[] = [];

  if (input.chunks.length > 0) {
    const numbered = input.chunks
      .map((chunk, i) => `[transcript sourceIndex=${i}]:\n${chunk}`)
      .join("\n\n");
    parts.push(`TRANSCRIPT CHUNKS:\n\n${numbered}`);
  }

  if (input.files && input.files.length > 0) {
    const numbered = input.files
      .map((f, i) => {
        const directive = f.context
          ? `\nDOCTOR'S DIRECTIVE FOR THIS FILE: ${f.context}`
          : "";
        return `[file sourceIndex=${i} name="${f.name}" type="${f.type}"]:${directive}\n${f.text}`;
      })
      .join("\n\n");
    parts.push(`UPLOADED FILE CONTENTS:\n\n${numbered}`);
  }

  if (input.doctorNotes && input.doctorNotes.trim()) {
    parts.push(
      `DOCTOR'S NOTES [doctor_notes sourceIndex=0]:\n${input.doctorNotes}`,
    );
  }

  parts.push(
    "Extract every clinical fact that is EXPLICITLY stated in the source material above. Return a single JSON object with the exact category keys listed in the system prompt. Every fact MUST include a verbatim evidence quote. IMPORTANT: If the DOCTOR'S NOTES contain explicit instructions to only use certain parts of uploaded files (e.g. 'only use blood pressure from the document', 'ignore the old diagnosis in the referral'), respect those instructions — only extract the permitted facts from those files. EQUALLY IMPORTANT: If a file section contains a line starting with 'DOCTOR'S DIRECTIVE FOR THIS FILE:', that directive OVERRIDES what you extract from that specific file. For example, if the directive says 'I only want the diagnosis from the file, nothing else', extract ONLY diagnosis-related facts from that file and skip everything else (demographics, measurements, findings, medications, procedures, plan, etc.). Per-file directives are strict filters — obey them exactly.",
  );

  return parts.join("\n\n");
}

/**
 * Run Pass 1.5: structured fact extraction via Haiku.
 *
 * Empty input short-circuits to an empty result (no API call).
 */
export async function runFactExtraction(
  input: FactExtractionInput,
  language: SupportedLanguage,
  ctx?: UsageContext,
): Promise<ExtractedFacts> {
  const hasContent =
    input.chunks.length > 0 ||
    (input.files?.length ?? 0) > 0 ||
    !!input.doctorNotes?.trim();
  if (!hasContent) {
    return emptyExtractedFacts();
  }

  const systemPrompt = buildFactExtractionSystemPrompt(language);
  const userMessage = buildFactExtractionUserMessage(input);

  const startTime = Date.now();
  // 16384 tokens — busy encounters with several OCR'd files and a long
  // transcript can easily produce 8–12k chars of fact JSON (one verbatim
  // evidence quote per fact). 4096 truncated the output mid-string on the
  // first real-world STEMI encounter; 16384 gives ~4x headroom while still
  // being well under Haiku 4.5's per-call output limit.
  const response = await anthropic().messages.create({
    model: HAIKU_MODEL,
    max_tokens: 16384,
    temperature: 0,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const elapsed = Date.now() - startTime;
  logger.debug(
    `[fact-extraction] ${elapsed}ms, tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`,
  );

  if (ctx) {
    logUsage({
      userId: ctx.userId,
      visitId: ctx.visitId,
      provider: "anthropic",
      model: HAIKU_MODEL,
      operation: "fact_extraction",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });
  }

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  const parsed = extractJson<Record<string, unknown>>(text);

  const facts: ExtractedFacts = emptyExtractedFacts();
  facts.usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };

  for (const category of FACT_CATEGORIES) {
    const raw = parsed[category];
    if (!Array.isArray(raw)) continue;
    const normalised: ExtractedFact[] = [];
    for (const item of raw) {
      const fact = coerceFact(item, category);
      if (fact) normalised.push(fact);
    }
    facts[category] = normalised;
  }

  return facts;
}

/**
 * Defensively coerce a model-emitted object into an `ExtractedFact`,
 * dropping entries that are missing required fields or malformed.
 * Exported for unit testing.
 */
export function coerceFact(
  raw: unknown,
  expectedCategory: FactCategory,
): ExtractedFact | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const value = typeof obj.value === "string" ? obj.value.trim() : "";
  if (!value) return null;

  const sourceRaw = obj.source;
  if (!sourceRaw || typeof sourceRaw !== "object") return null;
  const source = sourceRaw as Record<string, unknown>;

  const sourceType = source.type;
  if (
    sourceType !== "transcript" &&
    sourceType !== "doctor_notes" &&
    sourceType !== "file"
  ) {
    return null;
  }

  const sourceIndex =
    typeof source.sourceIndex === "number"
      ? source.sourceIndex
      : Number.parseInt(String(source.sourceIndex ?? ""), 10);
  if (!Number.isFinite(sourceIndex) || sourceIndex < 0) return null;

  const evidence =
    typeof source.evidence === "string" ? source.evidence.trim() : "";
  if (!evidence) return null;

  return {
    category: expectedCategory,
    value,
    source: {
      type: sourceType,
      sourceIndex,
      evidence,
    },
  };
}
