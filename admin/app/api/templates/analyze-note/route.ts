import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { extractTextFromUpload } from "@/lib/file-extraction";

let _anthropic: Anthropic | null = null;
function anthropic() {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

interface AnalyzedSection {
  label: string;
  context: string;
  subsections?: { label: string; context: string }[];
}

export interface AnalysisResult {
  extractedText: string;
  sections: AnalyzedSection[];
  styleGuide: string;
}

const ANALYSIS_PROMPT = `You are analyzing a medical document/note to extract two things:

1. **STRUCTURE**: Identify the document's section structure (headers and subheaders). For each section, provide:
   - "label": The section header name as it appears (e.g. "Anamnéza", "Objektívny nález", "Assessment")
   - "context": A short description (1-2 sentences) of what kind of content belongs in this section, based on what you see in the document. This will guide an AI that fills in the section later.
   - "subsections": If the section has clear sub-sections (sub-headers), list them with label + context. Omit if none.

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

Return valid JSON with this exact structure:
{
  "sections": [
    {
      "label": "Section Name",
      "context": "Description of what goes here",
      "subsections": [
        { "label": "Sub-section Name", "context": "Description" }
      ]
    }
  ],
  "styleGuide": "- Tone: ...\\n- Structure: ...\\n- Abbreviations: ...\\n- Person: ...\\n- Detail level: ...\\n- Distinctive: ..."
}

IMPORTANT:
- The section labels should be in the ORIGINAL LANGUAGE of the document.
- The context descriptions should be in English (they are internal AI guidance).
- The styleGuide should be in English as a bullet-point list (one "- Category: description" per line).
- If the document has no clear section structure (just flowing text), infer logical sections based on the content organization.
- Return ONLY valid JSON, no markdown or explanation.`;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");

    // Step 1: Extract text from the file
    const extractedText = await extractTextFromUpload(base64, file.type);
    if (!extractedText) {
      return NextResponse.json(
        {
          error:
            "Could not extract text from file. Supported: PDF, images, text files.",
        },
        { status: 422 },
      );
    }

    // Step 2: Analyze the extracted text with Claude
    const response = await anthropic().messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `${ANALYSIS_PROMPT}\n\nHere is the medical document text to analyze:\n\n---\n${extractedText}\n---`,
        },
      ],
    });

    const responseText =
      response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "Failed to parse analysis" },
        { status: 500 },
      );
    }

    const analysis = JSON.parse(jsonMatch[0]) as {
      sections: AnalyzedSection[];
      styleGuide: string;
    };

    const result: AnalysisResult = {
      extractedText,
      sections: analysis.sections,
      styleGuide: analysis.styleGuide,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("[admin] analyze-note error:", err);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
