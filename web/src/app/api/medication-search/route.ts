import { NextRequest, NextResponse } from "next/server";
import { searchMedications } from "@/lib/clinical";

/**
 * GET /api/medication-search?q=<query>&locale=<locale>
 * Search the medication database by name or active ingredient.
 * Locale determines which country's medication list is searched.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") || "";
  const locale = request.nextUrl.searchParams.get("locale") || "sk";

  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const results = searchMedications(q, 20, locale);
  return NextResponse.json({ results });
}
