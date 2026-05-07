import { NextResponse } from "next/server";
import { withAuth } from "@/lib/supabase/with-auth";
import { logAudit, createAuditContext } from "@/lib/audit";
import { dispatchNoteEmail } from "@/lib/email/send-note-email";

export const POST = withAuth(async (auth, request) => {
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

  await dispatchNoteEmail({
    userId,
    visitId,
    title:
      encounter.title ||
      ({ sk: "Bez názvu", cs: "Bez názvu", en: "Untitled" }[
        encounter.language as string
      ] ??
        "Untitled"),
    noteHtml: encounter.encounter_note,
    language: encounter.language || "sk",
  });

  logAudit({
    ...createAuditContext(auth, request),
    action: "email.send",
    resourceType: "encounter",
    resourceId: visitId,
  });

  return NextResponse.json({ success: true });
});
