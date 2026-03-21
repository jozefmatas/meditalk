import { NextRequest, NextResponse } from "next/server";
import { resolveTemplate } from "@/lib/templates/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const template = await resolveTemplate(id);
    return NextResponse.json(template);
  } catch {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }
}
