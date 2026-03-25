import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { LOCALES } from "@/lib/template-types";

const LOCALE_NAMES: Record<string, string> = {
  sk: "Slovak",
  en: "English",
  cs: "Czech",
};

let _anthropic: Anthropic | null = null;
function anthropic() {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

export async function POST(request: NextRequest) {
  try {
    const {
      texts,
      sourceLocale = "sk",
      targetLocales: requestedTargets,
    } = (await request.json()) as {
      texts: Record<string, string>;
      sourceLocale?: string;
      targetLocales?: string[];
    };

    const targetLocales =
      requestedTargets ?? LOCALES.filter((l) => l !== sourceLocale);

    const entries = Object.entries(texts);
    if (entries.length === 0) {
      const empty: Record<string, Record<string, string>> = {};
      for (const l of targetLocales) empty[l] = {};
      return NextResponse.json({ translations: empty });
    }

    const sourceName = LOCALE_NAMES[sourceLocale] ?? sourceLocale;
    const targetNames = targetLocales
      .map((l) => LOCALE_NAMES[l] ?? l)
      .join(" and ");
    const targetKeys = targetLocales.map((l) => `"${l}"`).join(", ");

    const prompt = `Translate the following ${sourceName} medical template labels to ${targetNames}.
Return JSON with keys: ${targetKeys}, each containing an object with the same keys as the input.
Keep medical terminology accurate. Keep abbreviations (RA, OA, SA, PA, AA, LA, EA, etc.) as-is — do not expand them.
Short labels should stay short. Preserve the style and length of the original.

Input:
${JSON.stringify(texts, null, 2)}

Return ONLY valid JSON, no explanation or markdown.`;

    const response = await anthropic().messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "{}";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "Failed to parse translations" },
        { status: 500 },
      );
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ translations: parsed });
  } catch (err) {
    console.error("[admin] translate error:", err);
    return NextResponse.json({ error: "Translation failed" }, { status: 500 });
  }
}
