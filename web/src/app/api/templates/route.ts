import { NextResponse } from "next/server";
import { resolveAllTemplates } from "@/lib/templates/server";

export async function GET() {
  try {
    const templates = await resolveAllTemplates();
    return NextResponse.json(templates);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
