import { NextRequest, NextResponse } from "next/server";
import { resolveAllTemplates } from "@/lib/templates/server";

export async function GET(request: NextRequest) {
  try {
    // Read locale from the NEXT_LOCALE cookie set by next-intl.
    // We cannot use a query param because next-intl intercepts any query
    // value that matches a configured locale and issues a 307 redirect.
    const locale = request.cookies.get("NEXT_LOCALE")?.value;
    const templates = await resolveAllTemplates(locale ?? undefined);
    return NextResponse.json(templates);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
