import { NextRequest, NextResponse } from "next/server";
import { searchIcd } from "@/lib/lookup/icd";

/**
 * GET /api/icd-search?q=<query>&locale=<locale>
 * Search the ICD-10 database by code prefix or description text.
 * Locale determines which language the descriptions are returned in.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") || "";
  const locale = request.nextUrl.searchParams.get("locale") || "en";

  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const results = searchIcd(q, 20, locale);
  return NextResponse.json({ results });
}
