/**
 * Generic section agent — renders ONE section of a clinical note.
 *
 * Reads the raw source (transcript + doctor notes + OCR files) and
 * returns a claims-with-evidence payload via Anthropic tool-use. Each
 * claim is one clinical sentence paired with the verbatim source span
 * that supports it. The server validates every claim's evidence
 * against the source (substring match, diacritic-folded) and drops
 * ungrounded claims. Survivors' `text` fields are joined into the
 * section body.
 *
 * This replaces the older free-text renderer + a whole stack of
 * regex safety nets (`isAbsenceDescription`, `stripBoilerplateExam`,
 * `stripUngroundedVitalValue`, the Slovak number-word lookup table).
 * Grounding is now enforced structurally by the tool-call schema +
 * server-side evidence validation, so the regex defences aren't
 * needed.
 */
import Anthropic from "@anthropic-ai/sdk";
import { logUsage, type UsageContext } from "../usage";
import { logger } from "../logger";

export type { UsageContext } from "../usage";

export interface RawSource {
  transcript?: string;
  doctorNotes?: string;
  /**
   * Files attached to the encounter. `context` is the doctor's optional
   * per-file instruction captured in the upload dialog ("focus on liver
   * markers, ignore old diagnosis") — surfaces to the LLM alongside the
   * file's text. When present, the pipeline has already filtered the
   * file via the file-focus extractor before the agent sees it.
   */
  files?: Array<{ name: string; text: string; context?: string }>;
}

export interface SectionConfig {
  /** Stable id — "la", "to", "zaver", … */
  id: string;
  /** Display title rendered in the final note ("LA", "TO", "Záver"). */
  title: string;
  /** Clinical contract. Admin-editable, specialty-aware. */
  context: string;
  /** Model tier for this section. */
  model: "haiku" | "sonnet" | "opus";
  /**
   * Ordered names of reconcilers to apply after the optional critic pass.
   * See `./reconcilers/index.ts`. Examples: `["drug-normalizer"]`,
   * `["icd-validator"]`.
   */
  reconcilers?: string[];
  /**
   * When true, a second Haiku call audits this section's draft against
   * the source before reconcilers run. With the claims agent as the
   * default renderer the critic is largely redundant (claims are
   * already grounded at render time) but remains opt-in for narrative
   * sections where an extra pass still helps.
   */
  critic?: boolean;
}

export interface RenderedSection {
  id: string;
  title: string;
  content: string;
  /**
   * The author's pre-critic draft. Populated only when the critic pass
   * actually modified the content — gives us a diff record for
   * debugging and eval-set construction.
   */
  draft?: string;
}

export type Language = "sk" | "cs" | "en";

/** One piece of the section body, paired with the source span that supports it. */
export interface SectionClaim {
  /** The clinical sentence / fragment as it should appear in the note. */
  text: string;
  /**
   * A VERBATIM substring of the source that supports this claim. For
   * paraphrases ("cukrovka" → "diabetes mellitus", "sto tridsaťpäť" →
   * "135") the model cites the spoken form as evidence. Server checks
   * that this substring appears in the encounter's source.
   */
  evidence: string;
  /**
   * `explicit` when the evidence verbatim states the fact. `inferred_paraphrase`
   * when the text is a standard clinical normalisation of a colloquial
   * evidence span. Used for telemetry; does not affect validation.
   */
  kind?: "explicit" | "inferred_paraphrase";
}

const MODEL_IDS: Record<SectionConfig["model"], string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
};

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ maxRetries: 4 });
  return _client;
}

const LANGUAGE_LABEL: Record<Language, string> = {
  sk: "Slovak",
  cs: "Czech",
  en: "English",
};

export async function renderSection(
  source: RawSource,
  section: SectionConfig,
  language: Language = "sk",
  usage?: UsageContext,
  templateSystemPrompt?: string,
  sectionExamples?: string[],
): Promise<RenderedSection> {
  const systemPrompt = buildSystemPrompt(
    section,
    language,
    templateSystemPrompt,
    sectionExamples,
  );
  const userMessage = buildUserMessage(source);
  const modelId = MODEL_IDS[section.model];

  const response = await client().messages.create({
    model: modelId,
    max_tokens: 3000,
    temperature: 0,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    tools: [
      {
        name: "submit_section_claims",
        description:
          "Submit the section body as a list of grounded claims. Each claim pairs the clinical text with the verbatim source span that supports it. Empty array when the section should have no content.",
        input_schema: {
          type: "object",
          properties: {
            claims: {
              type: "array",
              description:
                "Ordered list of claims forming the section. Empty array → empty section.",
              items: {
                type: "object",
                properties: {
                  text: {
                    type: "string",
                    description:
                      "The clinical sentence / fragment as it should appear in the note. 3rd-person clinical voice.",
                  },
                  evidence: {
                    type: "string",
                    description:
                      "ONE contiguous verbatim substring of the source that supports this claim. NEVER concatenate two spans with '…' / '...'. For speech→clinical paraphrases, cite the original spoken form (e.g. 'Pokašľávam' for the claim 'Pokašľáva, hlavne v zime'). Minimum 4 characters. Must appear verbatim in transcript / doctor notes / file text.",
                  },
                  kind: {
                    type: "string",
                    enum: ["explicit", "inferred_paraphrase"],
                    description:
                      "explicit = fact stated literally; inferred_paraphrase = colloquial form normalised (cukrovka → diabetes mellitus).",
                  },
                },
                required: ["text", "evidence"],
              },
            },
          },
          required: ["claims"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "submit_section_claims" },
  });

  if (usage) {
    logUsage({
      userId: usage.userId,
      visitId: usage.visitId,
      provider: "anthropic",
      model: modelId,
      operation: "generate_section",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });
  }

  // Extract the tool-call payload.
  const rawClaims: SectionClaim[] = [];
  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === "submit_section_claims") {
      const input = block.input as { claims?: unknown };
      if (Array.isArray(input.claims)) {
        for (const c of input.claims) {
          if (!c || typeof c !== "object") continue;
          const obj = c as Record<string, unknown>;
          if (typeof obj.text !== "string") continue;
          if (typeof obj.evidence !== "string") continue;
          rawClaims.push({
            text: obj.text.trim(),
            evidence: obj.evidence.trim(),
            kind:
              obj.kind === "explicit" || obj.kind === "inferred_paraphrase"
                ? obj.kind
                : undefined,
          });
        }
      }
      break;
    }
  }

  const validated = validateClaims(rawClaims, source);
  const content = validated
    .map((c) => c.text.trim())
    .filter(Boolean)
    .join("\n");

  if (rawClaims.length !== validated.length) {
    const dropped = rawClaims.filter((c) => !validated.includes(c));
    logger.debug(
      `[section-agent] "${section.title}" (${section.id}): kept ${validated.length}/${rawClaims.length} claim(s). Dropped: ${JSON.stringify(
        dropped.map((c) => ({
          text: c.text.slice(0, 60),
          evidence: c.evidence.slice(0, 40),
        })),
      )}`,
    );
  }

  return { id: section.id, title: section.title, content };
}

// ─── Claim validation ────────────────────────────────────────────────

/**
 * Keep only claims whose `evidence` actually appears in the source
 * (after diacritic-fold + lowercase). Server-side hallucination gate.
 * Exported for tests; used here to gate section-agent output.
 */
export function validateClaims(
  claims: SectionClaim[],
  source: RawSource,
): SectionClaim[] {
  const sourceBlob = [
    source.transcript ?? "",
    source.doctorNotes ?? "",
    ...(source.files ?? []).map((f) => f.text ?? ""),
  ].join("\n");
  const folded = foldText(sourceBlob);

  const out: SectionClaim[] = [];
  for (const claim of claims) {
    const evidence = claim.evidence.trim();
    // Minimum 4 chars: short enough to accept clinical abbreviations as
    // evidence anchors (LPHB, RBBB, ASP), long enough to avoid accidental
    // 1-2 char substring collisions in the source.
    if (evidence.length < 4) continue;
    if (!folded.includes(foldText(evidence))) continue;
    out.push(claim);
  }
  return out;
}

function foldText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// ─── Prompt assembly ─────────────────────────────────────────────────

function buildSystemPrompt(
  section: SectionConfig,
  language: Language,
  templateSystemPrompt?: string,
  sectionExamples?: string[],
): string {
  const localeLabel = LANGUAGE_LABEL[language];

  const templateBlock = templateSystemPrompt?.trim()
    ? `\n\n# Template-wide guardrails (apply to every section in this template)\n${templateSystemPrompt.trim()}`
    : "";

  const examplesBlock =
    sectionExamples && sectionExamples.length > 0
      ? `\n\n# Voice examples for "${section.title}" (senior-attending notes from this template's corpus)\nMimic the TONE and STRUCTURE of these examples. NEVER copy patient-specific facts, numbers, names, or dates from them — those belong to other patients. Use them only as style references for how this doctor writes this section.\n\n${sectionExamples
          .map((ex, i) => `Example ${i + 1}:\n${ex}`)
          .join("\n\n")}`
      : "";

  return `# Role
You extract the "${section.title}" section of a structured ${localeLabel} clinical note from the raw encounter source. Output is a list of claims, each paired with the verbatim source span that supports it.

# Tool-use contract
You MUST respond by calling \`submit_section_claims\` with an object \`{claims: [...]}\`. Each claim has:
- \`text\`: the clinical sentence / fragment that belongs in the note (3rd-person, ${localeLabel} clinical style, normalised wording).
- \`evidence\`: a VERBATIM substring (≥8 chars) from the transcript / doctor notes / file text that supports this claim.
- \`kind\`: "explicit" (fact stated literally) OR "inferred_paraphrase" (colloquial spoken form normalised — e.g. "cukrovka" → "diabetes mellitus").

# Why the evidence field matters (do not fake this)
The server checks that \`evidence\` appears verbatim in the source. Fabricated evidence → the claim is silently DROPPED from the note. Faking evidence is strictly worse than emitting no claim. If you don't have a source span that supports the claim, do not emit the claim.

# Paraphrase rule (safe normalisations that still need evidence)
When normalising colloquial speech into clinical terms, cite the spoken span verbatim. The \`text\` field uses the clinical form; \`evidence\` keeps the original.
- Patient says "Pokašľávam, hlavne v zime" → \`text: "Pokašľáva, hlavne v zime."\`, \`evidence: "Pokašľávam, hlavne v zime"\`, \`kind: "inferred_paraphrase"\`.
- Patient says "sto tridsaťpäť na osemdesiat" (BP) → \`text: "TK 135/80 mmHg."\`, \`evidence: "sto tridsaťpäť na osemdesiat"\`, \`kind: "inferred_paraphrase"\`.
- Patient says "zomrel na mozgovú cievu" → \`text: "Zomrel na mozgovú príhodu (CMP)."\`, \`evidence: "zomrel na mozgovú"\`, \`kind: "inferred_paraphrase"\`.
- Patient says "mám cukrovku" → \`text: "Diabetes mellitus."\`, \`evidence: "mám cukrovku"\`, \`kind: "inferred_paraphrase"\`.

## Paraphrasing denials (HARD — do not drop these)
Patient denials are frequently split across a doctor's question and the patient's short answer. When the doctor asked about X and the patient answered in the negative — including soft / hedged negatives ("Myslím, že nie", "Asi nie", "Nepamätám si") — EMIT the denial as \`X neguje.\` with the patient's answer as evidence.
- Doctor asks "Alergiu na niečo?" / patient answers "Myslím, že nie" → \`text: "Alergie neguje."\`, \`evidence: "Myslím, že nie"\`, \`kind: "inferred_paraphrase"\`.
- Doctor asks "Alergiu nemáte na nič?" / patient answers "Nemám" → \`text: "Alergie neguje."\`, \`evidence: "Alergiu nemáte na nič? Nemám"\`, \`kind: "inferred_paraphrase"\`.
Silence ≠ denial still applies: if the doctor never asked and the patient never mentioned a topic, do NOT emit a denial for it.

## Abbreviation evidence
Clinical short forms (LPHB, RBBB, ASP, EKG, SF, EF, CMP, AH, ST, pro BNP, troponin…) are meaningful tokens. When citing an abbreviation as evidence, include at least 4 characters — a single 3-letter token ("SF") is too ambiguous; include its neighbour ("SF 70" / "SF, RS" / "ASP, RS"). Pick the shortest span that uniquely anchors the finding in the source.

# Empty section
If nothing in the source satisfies THIS section's contract, return \`{"claims": []}\`. The server renders empty sections invisibly. Do NOT fabricate placeholder denials ("Alkohol neguje", "Akútne negat.", "Infekčné ochorenie neguje") when the source is silent on the topic — silence is not a denial.

# Core rules
1. GROUND TRUTH. Every claim's evidence must be in the source. No exceptions.
2. STAY IN LANE. Only claims that satisfy THIS section's contract. Other sections will claim what doesn't belong.
3. NO DENIAL INVENTION. Silence ≠ denial. Don't emit "X neguje" unless the source contains the denial.${templateBlock}${examplesBlock}

# Section contract (binding)
${section.context}`;
}

function buildUserMessage(source: RawSource): string {
  const parts: string[] = [];
  if (source.transcript?.trim()) {
    parts.push(`# Transcript\n${source.transcript.trim()}`);
  }
  if (source.doctorNotes?.trim()) {
    parts.push(`# Doctor notes\n${source.doctorNotes.trim()}`);
  }
  for (const file of source.files ?? []) {
    if (!file.text.trim()) continue;
    const ctx = file.context?.trim();
    const header = ctx
      ? `# File: ${file.name}\nDoctor's focus for this file: ${ctx}`
      : `# File: ${file.name}`;
    parts.push(`${header}\n${file.text.trim()}`);
  }
  return parts.join("\n\n");
}
