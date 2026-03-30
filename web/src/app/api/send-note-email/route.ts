import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { logAudit, createAuditContext } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNoteEmail } from "@/lib/email/send-note-email";
import { filterEmptySectionsHtml } from "@/lib/parse-note-sections";

export async function POST(request: Request) {
  try {
    const auth = await requireAuth();
    const { userId, supabase } = auth;
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
      .select("title, encounter_note, language")
      .eq("id", visitId)
      .eq("user_id", userId)
      .single();

    if (fetchError || !encounter) {
      return NextResponse.json(
        { error: "Encounter not found" },
        { status: 404 },
      );
    }

    if (!encounter.encounter_note) {
      return NextResponse.json(
        { error: "No generated note to send" },
        { status: 400 },
      );
    }

    // Get user email — use admin.getUserById instead of supabase.auth.getUser()
    // because during impersonation supabase is a service-role client with no session.
    const admin = createAdminClient();
    const { data: userData } = await admin.auth.admin.getUserById(userId);
    const userEmail = userData?.user?.email;

    if (!userEmail) {
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

    const { data: linkData } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: userEmail,
      options: { redirectTo },
    });

    // Use magic link if available, otherwise fall back to direct link
    const viewUrl =
      linkData?.properties?.action_link || `${appUrl}${encounterPath}`;

    await sendNoteEmail({
      to: userEmail,
      title: encounter.title || "Untitled",
      noteHtml: filterEmptySectionsHtml(encounter.encounter_note),
      viewUrl,
      language,
    });

    logAudit({
      ...createAuditContext(auth, request),
      action: "email.send",
      resourceType: "encounter",
      resourceId: visitId,
      metadata: { recipient: userEmail },
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
