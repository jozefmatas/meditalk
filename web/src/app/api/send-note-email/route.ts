import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNoteEmail } from "@/lib/email/send-note-email";
import { filterEmptySectionsHtml } from "@/lib/parse-soap-sections";

export async function POST(request: Request) {
  try {
    const { userId, supabase } = await requireAuth();
    const { visitId } = await request.json();

    if (!visitId) {
      return NextResponse.json(
        { error: "visitId is required" },
        { status: 400 },
      );
    }

    // Fetch encounter
    const { data: encounter, error: fetchError } = await supabase
      .from("visits")
      .select("title, soap_note, language")
      .eq("id", visitId)
      .eq("user_id", userId)
      .single();

    if (fetchError || !encounter) {
      return NextResponse.json(
        { error: "Encounter not found" },
        { status: 404 },
      );
    }

    if (!encounter.soap_note) {
      return NextResponse.json(
        { error: "No generated note to send" },
        { status: 400 },
      );
    }

    // Get user email
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.email) {
      return NextResponse.json(
        { error: "User email not found" },
        { status: 400 },
      );
    }

    // Generate magic link for "View in App" button
    const language = encounter.language || "sk";
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
    const encounterPath = `/${language}/encounters/${visitId}`;
    const redirectTo = `${appUrl}${encounterPath}`;

    const admin = createAdminClient();
    const { data: linkData } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: user.email,
      options: { redirectTo },
    });

    // Use magic link if available, otherwise fall back to direct link
    const viewUrl =
      linkData?.properties?.action_link || `${appUrl}${encounterPath}`;

    await sendNoteEmail({
      to: user.email,
      title: encounter.title || "Untitled",
      noteHtml: filterEmptySectionsHtml(encounter.soap_note),
      viewUrl,
      language,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Send note email error:", error);
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 },
    );
  }
}
