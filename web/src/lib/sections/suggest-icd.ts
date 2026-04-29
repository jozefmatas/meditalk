/**
 * ICD-10 suggestion pass — runs ONCE per generation.
 *
 * Produces 10–15 candidate codes for the encounter based on the raw
 * source. Output feeds:
 *   1. The right-side "Navrhované kódy" panel (UI).
 *   2. The conclusion section as structured context (diagnoses list),
 *      rendered by the normal section-agent like any other section.
 *
 * Returns codes in WHO Slovak format. Validates every code against the
 * Slovak CSV before shipping — unknown codes are dropped.
 */
import { resolve } from "../models";
import { logUsage, type UsageContext } from "../usage";
import { getIcdDescription } from "../lookup/icd";
import { logger } from "../logger";
import type { Language, PassageCategory, RawSource } from "./section-agent";

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
  // When files carry classified passages, filter out medication-only
  // and procedure-only content so the ICD suggester doesn't hallucinate
  // diagnoses from drug names (e.g. "Ramipril" → I10 Hypertension).
  const ICD_RELEVANT: Set<PassageCategory> = new Set([
    "diagnosis",
    "finding",
    "history",
    "vital",
    "general",
  ]);

  const fileBlocks: string[] = [];
  for (const f of source.files ?? []) {
    let fileText: string;
    if (f.classifiedPassages?.length) {
      const kept = f.classifiedPassages.filter((p) =>
        ICD_RELEVANT.has(p.category),
      );
      fileText = kept.map((p) => p.text).join("\n\n");
    } else {
      fileText = f.text;
    }
    if (fileText.trim()) {
      fileBlocks.push(`# File: ${f.name}\n${fileText.trim()}`);
    }
  }

  const sourceDump = [
    source.transcript ? `# Transcript\n${source.transcript.trim()}` : "",
    source.doctorNotes ? `# Doctor notes\n${source.doctorNotes.trim()}` : "",
    ...fileBlocks,
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

## Specificity is NOT optional
If the transcript names the anatomy in Slovak ("laterálnej steny", "prednej steny", "spodnej steny", "inferolaterálny") AND you can see an ST-elevation pattern in the source, emit the SPECIFIC I21.0/I21.1/I21.2 code. I21.9 is explicitly WRONG here — the source gave you enough to specify, and I21.9 means "we couldn't tell". Using I21.9 when a specific site is named is a CODING ERROR, not safety. The specific code is what the clinician documented; defaulting to I21.9 drops information.

# Tobacco use in cardiology notes
Long-term active smoking with daily pack-count ("fajčiar pätnásť cigariet denne", "dlhoročný fajčiar") is routinely coded in Slovak cardiology as **F17.2** (Porucha psychiky a správania zapríčinená užívaním tabaku: syndróm závislosti). Include F17.2 when the patient reports established daily smoking, not just occasional.

# Anatomy, severity, subtype, etiology — specificity matters
The source's exact wording drives the code. Common traps to avoid:
- "mitrálna regurgitácia" → I34.x (mitral). NEVER I35.x (aortic).
- "paroxyzmálna fibrilácia predsiení" → I48.0 (paroxysmal). NEVER I48.1 (persistent).
- "AV blok 1. stupňa" → I44.0 (first degree). NEVER I44.1 (second degree).
- "st.p. strumektómii, na terapii Euthyroxom" → E89.0 (post-surgical hypothyroidism). NEVER E03.2 (drug-induced).
- "st.p. operácii katarakty" → Z96.1 or omit. NEVER H26.9 (active cataract).
- "monoklonálna gamapatia" / "MGUS" / "gamapatia typu IgG" → D47.2 (Monoklonálna gamapatia). Commonly phrased in reports as "MGUS" or "gamapatia typu IgG kappa vs MGUS" — both map to D47.2.
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

# Tool-use contract
Respond by calling \`submit_icd_candidates\` with \`{codes: [...]}\`. Each code carries an \`evidence\` field — ONE verbatim contiguous substring of the source that supports the diagnosis. The server verifies evidence against source; unsupported codes are DROPPED.
- \`evidence\` rules (HARD):
  - ONE contiguous span copied verbatim from the source, no paraphrasing, no normalisation, no typo-fixing.
  - NEVER concatenate multiple spans with "…", "...", or other joiners. If you need to cite two places, pick the MORE TELLING single span.
  - At least 4 characters. A short diagnostic abbreviation (e.g. "I10", "SZpEF", "AH") is fine if that is the actual token in the source.
  - If the code is a chronic comorbidity from an OA list, cite the line entry (e.g. "Arteriová hypertenzia" from the discharge letter).
  - If the code is today's primary, cite the clinician's assessment phrase (e.g. "Non STE AKS (subakutny v.s.)", "stemy laterálnej steny ľavej komory").
- Order by clinical relevance: primary first, chronic comorbidities next, states-post last.
- Confidence: "high" = explicitly diagnosed; "medium" = strongly implied; "low" = plausible but less certain.
- 10–15 codes total. If the encounter is genuinely simple, fewer is fine.
- Omit \`differential\` unless the primary is a symptom code awaiting work-up.
- Faking evidence is strictly worse than omitting a code.`;

  const userMessage = `# Raw source\n${sourceDump}`;

  try {
    const provider = resolve("suggest-icd", "haiku");
    const result = await provider.generate({
      maxTokens: 3000,
      temperature: 0,
      system: [{ text: systemPrompt }],
      user: userMessage,
      tool: {
        name: "submit_icd_candidates",
        description:
          "Submit 10–15 candidate ICD-10 codes for the encounter, each paired with the verbatim source span that supports it.",
        schema: {
          type: "object",
          properties: {
            codes: {
              type: "array",
              description:
                "Ordered list of ICD-10 candidates. Primary first, chronic comorbidities next, states-post last.",
              items: {
                type: "object",
                properties: {
                  code: {
                    type: "string",
                    description:
                      "WHO Slovak ICD-10 code: Letter + 2 digits optionally + `.digit` or `.digit-digit`. Reject ICD-10-CM codes with 3+ digits after the decimal.",
                  },
                  description: {
                    type: "string",
                    description:
                      "Short description of the code (server overrides with canonical CSV text, but include for clarity).",
                  },
                  confidence: {
                    type: "string",
                    enum: ["high", "medium", "low"],
                    description:
                      "high = explicitly diagnosed; medium = strongly implied; low = plausible but uncertain.",
                  },
                  evidence: {
                    type: "string",
                    description:
                      "ONE contiguous verbatim substring of the source (≥4 chars) that supports this diagnosis. NEVER concatenate with '…' / '...' — pick one span. For chronic comorbidities, cite the OA list entry verbatim. Required.",
                  },
                  differential: {
                    type: "string",
                    description:
                      "Verbatim 'nemožno vylúčiť …' clause from the source. Only for symptom-code primaries awaiting work-up.",
                  },
                },
                required: ["code", "description", "confidence", "evidence"],
              },
            },
          },
          required: ["codes"],
        },
      },
    });

    if (usage) {
      logUsage({
        userId: usage.userId,
        visitId: usage.visitId,
        provider: provider.name,
        model: provider.model,
        operation: "clinical_analysis",
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });
    }

    const rawCodes: Array<{
      code?: string;
      description?: string;
      confidence?: string;
      evidence?: string;
      differential?: string;
    }> = Array.isArray(result.toolInput?.codes)
      ? (result.toolInput.codes as Array<{
          code?: string;
          description?: string;
          confidence?: string;
          evidence?: string;
          differential?: string;
        }>)
      : [];

    // Build a source blob for evidence validation (same shape as the
    // section-agent's validation).
    const sourceBlob = foldForValidation(
      [
        source.transcript ?? "",
        source.doctorNotes ?? "",
        ...(source.files ?? []).map((f) => f.text ?? ""),
      ].join("\n"),
    );

    // Validate each code: CSV-validate + evidence-in-source + dedup.
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
      const evidence = typeof c.evidence === "string" ? c.evidence.trim() : "";
      if (evidence.length < 4) {
        logger.debug(`[suggest-icd] drop code ${code} — missing evidence`);
        continue;
      }
      if (!sourceBlob.includes(foldForValidation(evidence))) {
        logger.debug(
          `[suggest-icd] drop code ${code} — evidence not in source: "${evidence.slice(0, 80)}"`,
        );
        continue;
      }
      seen.add(code);
      valid.push({
        code,
        description: canonical,
        confidence:
          c.confidence === "high" ||
          c.confidence === "medium" ||
          c.confidence === "low"
            ? c.confidence
            : undefined,
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

function foldForValidation(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
