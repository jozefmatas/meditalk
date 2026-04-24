import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { extractTextFromUpload } from "@/lib/file-extraction";
import { supabaseAdmin } from "@/lib/supabase";
import { scrubPhi } from "@/lib/phi-scrubber";
import { logger } from "@/lib/logger";

let _anthropic: Anthropic | null = null;
function anthropic() {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

type SectionKind =
  | "default"
  | "history-narrative"
  | "vital-numeric"
  | "exam-narrative"
  | "medication-list"
  | "conclusion";

const VALID_KINDS: readonly SectionKind[] = [
  "default",
  "history-narrative",
  "vital-numeric",
  "exam-narrative",
  "medication-list",
  "conclusion",
] as const;

function isSectionKind(x: unknown): x is SectionKind {
  return typeof x === "string" && (VALID_KINDS as readonly string[]).includes(x);
}

interface AnalyzedSection {
  label: string;
  kind: SectionKind;
  context: string;
  subsections?: { label: string; kind: SectionKind; context: string }[];
}

export interface AnalysisResult {
  extractedText: string;
  sections: AnalyzedSection[];
  styleGuide: string;
  /**
   * Candidate `styleExamples` entry — PHI-scrubbed full extracted text,
   * ready for persistence on `templates.style_examples`. The caller
   * matches `sections[].label` against its target template's labels
   * (client-side) to show which sections will have examples captured.
   */
  proposedExample: { name: string; text: string };
  /** Count of PHI redactions applied during the scrub pass. */
  phiRedactions: number;
}

const ANALYSIS_PROMPT = `You are analyzing a medical document/note to extract two things:

1. **STRUCTURE**: Identify the document's section structure (headers and subheaders). For each section, provide:
   - "label": The section header name as it appears (e.g. "Anamnéza", "Objektívny nález", "Assessment").
   - "kind": Classify the section's nature — drives downstream rendering behaviour:
       • "default"           — narrative prose (RA / SA / PA / EA / Ab / family-social history).
       • "history-narrative" — HPI / current-illness synthesis ("Terajšie ochorenie", "Nynejší onemocnenie", "History of present illness").
       • "vital-numeric"     — single-value vitals (Výška / Hmotnosť / BMI / TK / Pulz / EKG / SF).
       • "exam-narrative"    — general physical exam ("Celkové vyšetrenie", "Fyzikálne vyšetrenie", "Celkový stav").
       • "medication-list"   — current medications ("LA", "Lieková anamnéza", "Medications").
       • "conclusion"        — assessment / diagnostic summary ("Záver", "Assessment", "Conclusion", "Diagnosis").
   - "context": A short description (1-2 sentences) of what kind of content belongs in this section, based on what you see in the document. This will guide an AI that fills in the section later.
   - "subsections": If the section has clear sub-sections (sub-headers), list them with label + kind + context. Omit if none.

2. **WRITING STYLE**: Analyze the writing style and produce a bullet-point style guide. Each bullet should cover one aspect:
   - Tone (formal/informal, clinical/conversational)
   - Structure preferences (bullet points, numbered lists, flowing prose, or mixed)
   - Sentence patterns (short telegraphic vs. complete sentences, fragments)
   - Abbreviation usage (does the author use medical abbreviations freely or spell things out)
   - Person/voice (third person, passive, impersonal)
   - Formality markers (Latin terms, colloquial shortcuts, standardized phrases)
   - Quantification style (how measurements, dosages, values are formatted)
   - Detail level (terse/minimal vs. thorough/verbose)
   - Any distinctive patterns (recurring phrases, signature formatting quirks)

# Rules
- Section labels stay in the ORIGINAL LANGUAGE of the document.
- Context descriptions are in English (internal AI guidance).
- styleGuide is in English as a bullet-point list (one "- Category: description" per line).
- If the document has no clear section structure, infer logical sections from the content.
- Respond by calling the \`submit_template_analysis\` tool — no free text.`;

const ANALYSIS_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Original-language header." },
          kind: {
            type: "string",
            enum: VALID_KINDS,
            description: "Section classification (see prompt).",
          },
          context: {
            type: "string",
            description: "English description of what belongs here.",
          },
          subsections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                kind: { type: "string", enum: VALID_KINDS },
                context: { type: "string" },
              },
              required: ["label", "kind", "context"],
            },
          },
        },
        required: ["label", "kind", "context"],
      },
    },
    styleGuide: {
      type: "string",
      description:
        "English bullet-point list, one '- Category: description' per line.",
    },
  },
  required: ["sections", "styleGuide"],
};

export async function POST(request: NextRequest) {
  const supabase = supabaseAdmin();
  let tempFilePath: string | null = null;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";
    const isText = file.type === "text/plain" || file.type === "text/markdown";

    // Step 1: Upload to storage and create signed URL (for images/PDFs, no 5MB limit)
    let extractedText: string | null = null;

    if (isText) {
      // Plain text: extract directly
      extractedText = await extractTextFromUpload({ buffer }, file.type);
    } else if (isPdf || isImage) {
      // Upload to temporary storage location
      const fileId = crypto.randomUUID();
      tempFilePath = `temp/analyze-note/${fileId}-${file.name}`;

      let finalBuffer: Buffer<ArrayBufferLike> = buffer;

      // For images: EXIF auto-rotate before uploading (fixes phone photos)
      if (isImage) {
        logger.debug("[analyze-note] EXIF auto-rotating image before upload");
        finalBuffer = await sharp(buffer).rotate().toBuffer();
      }

      const { error: uploadError } = await supabase.storage
        .from("encounter-files")
        .upload(tempFilePath, finalBuffer, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        logger.error("[analyze-note] Upload failed:", uploadError);
        return NextResponse.json(
          { error: "Failed to upload file" },
          { status: 500 },
        );
      }

      // Create signed URL (5 min expiry)
      const { data: urlData, error: urlError } = await supabase.storage
        .from("encounter-files")
        .createSignedUrl(tempFilePath, 300);

      if (urlError || !urlData?.signedUrl) {
        logger.error("[analyze-note] Signed URL failed:", urlError);
        return NextResponse.json(
          { error: "Failed to create signed URL" },
          { status: 500 },
        );
      }

      // Extract text using signed URL (no size limit)
      if (isPdf) {
        extractedText = await extractTextFromUpload(
          { pdfUrl: urlData.signedUrl },
          file.type,
        );
      } else {
        extractedText = await extractTextFromUpload(
          { imageUrl: urlData.signedUrl },
          file.type,
        );
      }
    }

    if (!extractedText) {
      return NextResponse.json(
        {
          error:
            "Could not extract text from file. Supported: PDF, images, text files.",
        },
        { status: 422 },
      );
    }

    // Step 2: Analyze the extracted text with Claude.
    // Forced tool-use — the model's response is always a structured
    // payload; no free-text + regex parsing.
    const response = await anthropic().messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: ANALYSIS_PROMPT,
      messages: [
        {
          role: "user",
          content: `# Medical document to analyze\n\n---\n${extractedText}\n---`,
        },
      ],
      tools: [
        {
          name: "submit_template_analysis",
          description:
            "Submit the structured template analysis — section tree (with kind taxonomy) and a bullet-list style guide.",
          input_schema: ANALYSIS_TOOL_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: "submit_template_analysis" },
    });

    let rawAnalysis: unknown = null;
    for (const block of response.content) {
      if (block.type === "tool_use" && block.name === "submit_template_analysis") {
        rawAnalysis = block.input;
        break;
      }
    }

    const analysis = coerceAnalysis(rawAnalysis);
    if (!analysis) {
      return NextResponse.json(
        { error: "Failed to parse analysis" },
        { status: 500 },
      );
    }

    const { scrubbed, redactions } = scrubPhi(extractedText);

    const result: AnalysisResult = {
      extractedText,
      sections: analysis.sections,
      styleGuide: analysis.styleGuide,
      proposedExample: {
        name: file.name,
        text: scrubbed,
      },
      phiRedactions: redactions,
    };

    return NextResponse.json(result);
  } catch (err) {
    logger.error("[admin] analyze-note error:", err);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  } finally {
    // Clean up temporary file
    if (tempFilePath) {
      await supabase.storage
        .from("encounter-files")
        .remove([tempFilePath])
        .catch((err) =>
          logger.error("[analyze-note] Failed to delete temp file:", err),
        );
    }
  }
}

// ─── Tolerant coercion ──────────────────────────────────────────────
//
// Drops malformed entries (missing required fields, unknown kind) but
// preserves the rest so admins get partial results they can edit.

function coerceAnalysis(
  raw: unknown,
): { sections: AnalyzedSection[]; styleGuide: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const styleGuide =
    typeof obj.styleGuide === "string" ? obj.styleGuide.trim() : "";
  const rawSections = Array.isArray(obj.sections) ? obj.sections : [];

  const sections: AnalyzedSection[] = [];
  for (const s of rawSections) {
    if (!s || typeof s !== "object") continue;
    const so = s as Record<string, unknown>;
    const label = typeof so.label === "string" ? so.label.trim() : "";
    const context = typeof so.context === "string" ? so.context.trim() : "";
    if (!label) continue;
    const kind: SectionKind = isSectionKind(so.kind) ? so.kind : "default";

    const subsRaw = Array.isArray(so.subsections) ? so.subsections : [];
    const subsections: { label: string; kind: SectionKind; context: string }[] = [];
    for (const sub of subsRaw) {
      if (!sub || typeof sub !== "object") continue;
      const subo = sub as Record<string, unknown>;
      const subLabel =
        typeof subo.label === "string" ? subo.label.trim() : "";
      if (!subLabel) continue;
      const subKind: SectionKind = isSectionKind(subo.kind)
        ? subo.kind
        : "default";
      const subContext =
        typeof subo.context === "string" ? subo.context.trim() : "";
      subsections.push({ label: subLabel, kind: subKind, context: subContext });
    }

    sections.push({
      label,
      kind,
      context,
      ...(subsections.length ? { subsections } : {}),
    });
  }

  if (sections.length === 0 && !styleGuide) return null;
  return { sections, styleGuide };
}
