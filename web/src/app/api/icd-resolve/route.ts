import { NextRequest, NextResponse } from "next/server";
import { resolveIcdCodes } from "@/lib/lookup/icd";

/**
 * POST /api/icd-resolve
 * Resolve ICD codes to localized descriptions.
 * Body: { codes: string[], locale: string }
 */
export async function POST(request: NextRequest) {
  const { codes, locale = "en" } = await request.json();

  if (!Array.isArray(codes) || codes.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const resolved = resolveIcdCodes(codes, locale);
  // Zip input codes with resolved results so the client can map back
  const results = (codes as string[]).map((inputCode: string, i: number) => ({
    inputCode,
    code: resolved[i].code,
    description: resolved[i].description,
    found: resolved[i].found,
  }));
  return NextResponse.json({ results });
}
