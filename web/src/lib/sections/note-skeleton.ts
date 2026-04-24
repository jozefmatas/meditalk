/**
 * Note-skeleton extractor — one Sonnet call per visit that reads the
 * raw encounter source and produces a shared structured context that
 * every downstream section renderer + critic can consume.
 *
 * Motivation: each section renderer is otherwise isolated — it sees
 * only its own contract and the raw source, with no awareness of
 * encounter type, chief complaint, sibling sections, or the cast of
 * providers. Giving every section a shared "skeleton" improves
 * cross-section consistency (e.g. transfer origin, admission date,
 * referring physician appear the same everywhere).
 *
 * Output is hybrid: enums + arrays where structure matters
 * (`encounterType`, `keyDates[]`, `providers[]`), free-text where
 * nuance matters (`chiefComplaint`, `clinicalSummary`). Combined
 * free-text is capped at 600 chars so the skeleton fits under the
 * cached template prefix in per-section prompts.
 *
 * On `confidence === "low"` the extractor returns `null` — the
 * downstream pipeline treats that as "no skeleton" and renders
 * exactly as it does today. Failures (network / model) also return
 * `null`.
 */
import Anthropic from "@anthropic-ai/sdk";
import { logUsage, type UsageContext } from "../usage";
import { logger } from "../logger";
import type { Language, RawSource } from "./section-agent";

const MODEL_ID = "claude-sonnet-4-6";

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

export type EncounterType =
  | "acute"
  | "chronic-followup"
  | "transfer"
  | "preventive"
  | "consult";

export interface NoteSkeleton {
  /** One-sentence chief complaint as the clinician would summarise it. */
  chiefComplaint: string;
  /** 2–4 sentence high-level clinical summary. */
  clinicalSummary: string;
  /** Encounter type classification. */
  encounterType: EncounterType;
  /** Important dates referenced by the source, each with a short label. */
  keyDates: Array<{ label: string; iso?: string }>;
  /** Anatomical / physiological systems primarily involved. */
  primarySystems: string[];
  /** Physician / facility names that should appear consistently across sections. */
  providers: string[];
  /** Critical findings the note's downstream sections must preserve. */
  criticalFindings: string[];
  /** Self-rated confidence. Low → caller treats result as null. */
  confidence: "high" | "medium" | "low";
}

/** Combined cap so the skeleton fits under the cached template prefix. */
const FREE_TEXT_CHAR_CAP = 600;

/**
 * Extract a structured skeleton of the encounter. Returns `null` on
 * extractor failure or low confidence; the pipeline is expected to
 * gracefully fall back to the no-skeleton behaviour (today's default).
 */
export async function extractSkeleton(
  source: RawSource,
  language: Language = "sk",
  usage?: UsageContext,
): Promise<NoteSkeleton | null> {
  const sourceDump = buildSourceDump(source);
  if (!sourceDump.trim()) return null;

  const systemPrompt = buildSystemPrompt(language);
  const userMessage = `# Encounter source\n${sourceDump}`;

  try {
    const response = await client().messages.create({
      model: MODEL_ID,
      max_tokens: 1500,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      tools: [
        {
          name: "submit_skeleton",
          description:
            "Submit the structured skeleton of the clinical encounter. Every downstream section renderer sees this.",
          input_schema: SKELETON_TOOL_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: "submit_skeleton" },
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

    let raw: unknown = null;
    for (const block of response.content) {
      if (block.type === "tool_use" && block.name === "submit_skeleton") {
        raw = block.input;
        break;
      }
    }

    const parsed = coerceSkeleton(raw);
    if (!parsed) {
      logger.debug("[note-skeleton] coerce failed — skeleton ignored");
      return null;
    }
    if (parsed.confidence === "low") {
      logger.debug("[note-skeleton] low confidence — skeleton ignored");
      return null;
    }
    return parsed;
  } catch (err) {
    logger.error("[note-skeleton] extraction failed:", err);
    return null;
  }
}

/**
 * Render a `NoteSkeleton` into a prose block suitable for embedding in
 * a renderer / critic user message. Stable ordering for prompt-cache
 * friendliness.
 */
export function formatSkeletonBlock(skeleton: NoteSkeleton): string {
  const lines: string[] = [];
  lines.push(`Chief complaint: ${skeleton.chiefComplaint}`);
  lines.push(`Encounter type: ${skeleton.encounterType}`);
  if (skeleton.primarySystems.length > 0) {
    lines.push(`Primary systems: ${skeleton.primarySystems.join(", ")}`);
  }
  if (skeleton.providers.length > 0) {
    lines.push(`Providers / facilities: ${skeleton.providers.join(", ")}`);
  }
  if (skeleton.keyDates.length > 0) {
    const dateList = skeleton.keyDates
      .map((d) => (d.iso ? `${d.label} (${d.iso})` : d.label))
      .join("; ");
    lines.push(`Key dates: ${dateList}`);
  }
  if (skeleton.criticalFindings.length > 0) {
    lines.push(
      `Critical findings: ${skeleton.criticalFindings.join("; ")}`,
    );
  }
  lines.push("");
  lines.push(`Summary: ${skeleton.clinicalSummary}`);
  return lines.join("\n");
}

// ─── Internals ───────────────────────────────────────────────────────

function buildSourceDump(source: RawSource): string {
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
  return parts.join("\n\n");
}

function buildSystemPrompt(language: Language): string {
  const localeLabel = LANGUAGE_LABEL[language];
  return `# Role
You extract a structured skeleton of a ${localeLabel} clinical encounter. Every downstream section of the note will see this skeleton and use it as shared context (chief complaint, encounter type, key dates, providers, critical findings).

# Accuracy rules (absolute)
1. GROUND TRUTH. Every field MUST be traceable to the encounter source. Do not invent providers, dates, or findings.
2. CONCISE. \`chiefComplaint\` + \`clinicalSummary\` combined must stay under ${FREE_TEXT_CHAR_CAP} characters. This is the hard budget — go shorter when possible.
3. NO SPECULATION. If the source does not name a chief complaint / encounter type, prefer low confidence over guessing.

# Encounter type
- \`acute\`: presentation for new acute symptoms (AKS, STEMI, stroke, pneumonia, etc.).
- \`chronic-followup\`: scheduled follow-up for a known chronic condition.
- \`transfer\`: the patient is being transferred in from another facility (admission from a referring hospital / department).
- \`preventive\`: screening / wellness / vaccine / prevention visit.
- \`consult\`: a specialist consult without admission.

# Key dates
Only include dates that appear in the source. Each entry has a human-readable \`label\` ("prior MI", "PCI date", "admission at referring hospital"); \`iso\` (YYYY-MM-DD) is optional — populate only when the source gives an unambiguous date.

# Providers
Include physician names and facility names that the doctor dictated or the source documents (e.g. "Dr. Baldovský", "CINRE", "Malacky", "Ružinov ER"). These should appear consistently across sections.

# Critical findings
Short bullet-style facts that matter across sections — e.g. "EF ~50 % with RCX hypokinesis", "ST elev. aVL, I + recip. depression III, aVF", "Post-strumectomy on Euthyrox". Max ~5 items; keep each under 80 chars.

# Confidence
- \`high\`: every field is plainly grounded in the source.
- \`medium\`: most fields grounded; a couple are the most natural read but not 100%.
- \`low\`: the source is too sparse or ambiguous to extract a reliable skeleton. When you emit \`low\`, the downstream pipeline DISCARDS the skeleton entirely — pick it only when partial data would actively mislead the note.

# Output
Respond by calling \`submit_skeleton\` with the populated fields. No text commentary.`;
}

const SKELETON_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    chiefComplaint: {
      type: "string",
      description:
        "One-sentence summary of why the patient presented today. Grounded in source.",
    },
    clinicalSummary: {
      type: "string",
      description:
        "2–4 sentence high-level summary of the encounter. Combined with chiefComplaint, stays under the free-text budget.",
    },
    encounterType: {
      type: "string",
      enum: [
        "acute",
        "chronic-followup",
        "transfer",
        "preventive",
        "consult",
      ],
      description: "Encounter classification.",
    },
    keyDates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          iso: {
            type: "string",
            description: "ISO 8601 date (YYYY-MM-DD) — omit if not certain.",
          },
        },
        required: ["label"],
      },
      description: "Dates mentioned in the source with a short label each.",
    },
    primarySystems: {
      type: "array",
      items: { type: "string" },
      description:
        "Anatomical / physiological systems primarily involved (e.g. 'cardiovascular', 'endocrine').",
    },
    providers: {
      type: "array",
      items: { type: "string" },
      description:
        "Physician names and facility names that appear in the source.",
    },
    criticalFindings: {
      type: "array",
      items: { type: "string" },
      description:
        "Short bullet-style facts (≤80 chars each) that downstream sections must preserve. Max ~5 items.",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description:
        "Self-rated confidence. Low → the pipeline discards the skeleton.",
    },
  },
  required: [
    "chiefComplaint",
    "clinicalSummary",
    "encounterType",
    "keyDates",
    "primarySystems",
    "providers",
    "criticalFindings",
    "confidence",
  ],
};

function coerceSkeleton(raw: unknown): NoteSkeleton | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const chiefComplaint = typeof obj.chiefComplaint === "string"
    ? obj.chiefComplaint.trim()
    : "";
  const clinicalSummary = typeof obj.clinicalSummary === "string"
    ? obj.clinicalSummary.trim()
    : "";
  if (!chiefComplaint || !clinicalSummary) return null;

  // Combined free-text cap — enforce server-side so a runaway summary
  // doesn't blow past the cached prefix budget downstream.
  if (chiefComplaint.length + clinicalSummary.length > FREE_TEXT_CHAR_CAP) {
    logger.debug(
      `[note-skeleton] over cap: ${chiefComplaint.length + clinicalSummary.length} > ${FREE_TEXT_CHAR_CAP}`,
    );
    return null;
  }

  const encounterType = isEncounterType(obj.encounterType)
    ? obj.encounterType
    : null;
  if (!encounterType) return null;

  const confidence =
    obj.confidence === "high" ||
    obj.confidence === "medium" ||
    obj.confidence === "low"
      ? obj.confidence
      : null;
  if (!confidence) return null;

  const keyDates = coerceKeyDates(obj.keyDates);
  const primarySystems = coerceStringArray(obj.primarySystems);
  const providers = coerceStringArray(obj.providers);
  const criticalFindings = coerceStringArray(obj.criticalFindings).map((s) =>
    s.slice(0, 120),
  );

  return {
    chiefComplaint,
    clinicalSummary,
    encounterType,
    keyDates,
    primarySystems,
    providers,
    criticalFindings,
    confidence,
  };
}

function isEncounterType(x: unknown): x is EncounterType {
  return (
    x === "acute" ||
    x === "chronic-followup" ||
    x === "transfer" ||
    x === "preventive" ||
    x === "consult"
  );
}

function coerceStringArray(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  const out: string[] = [];
  for (const v of x) {
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  }
  return out;
}

function coerceKeyDates(x: unknown): Array<{ label: string; iso?: string }> {
  if (!Array.isArray(x)) return [];
  const out: Array<{ label: string; iso?: string }> = [];
  for (const v of x) {
    if (!v || typeof v !== "object") continue;
    const obj = v as Record<string, unknown>;
    const label = typeof obj.label === "string" ? obj.label.trim() : "";
    if (!label) continue;
    const iso = typeof obj.iso === "string" ? obj.iso.trim() : undefined;
    out.push(iso ? { label, iso } : { label });
  }
  return out;
}
