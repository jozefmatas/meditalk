/**
 * Doctor feedback injection — queries active negative feedback and
 * formats it for injection into the section-agent prompt.
 *
 * Feedback flows:
 *   1. session.ts calls getActiveFeedback() once before the section loop
 *   2. buildFeedbackMap() produces per-section prompt blocks
 *   3. pipeline.ts passes each block into renderSection's system prompt
 *   4. After successful persist, incrementCleanStreaks() auto-retires
 *      entries that hit the streak threshold + purges PHI
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

// ── Types ─────────────────────────────────────────────────────────

export interface ActiveFeedback {
  id: string;
  sectionId: string | null;
  categories: string[];
  detail: string;
  sectionContent: string | null;
}

// ── Format helpers ────────────────────────────────────────────────

/**
 * Format a single feedback entry into a compact prompt line.
 *
 * Section-specific:
 *   - [hallucination] "Patient had no allergies" → Doctor: "Penicillin allergy in transcript"
 *
 * Global (section_id = null):
 *   - [GENERAL][style] → Doctor: "LA had wrong medication dose"
 */
export function formatFeedbackEntry(entry: ActiveFeedback): string {
  const isGlobal = entry.sectionId === null;
  const cats = entry.categories.length > 0 ? entry.categories.join(", ") : null;

  if (isGlobal) {
    const prefix = cats ? `- [GENERAL][${cats}]` : `- [GENERAL]`;
    return entry.detail ? `${prefix} → Doctor: "${entry.detail}"` : prefix;
  }

  const catBlock = cats ? `- [${cats}]` : `-`;
  const contentQuote = entry.sectionContent ? ` "${entry.sectionContent}"` : "";
  const doctorNote = entry.detail ? ` → Doctor: "${entry.detail}"` : "";

  return `${catBlock}${contentQuote}${doctorNote}`;
}

// ── DB queries ───────────────────────────────────────────────────

/**
 * Fetch active negative feedback for a doctor × template pair.
 * "Active" = rating 'down', not retired, not resolved.
 */
export async function getActiveFeedback(
  supabase: SupabaseClient,
  userId: string,
  templateId: string,
): Promise<ActiveFeedback[]> {
  const { data, error } = await supabase
    .from("section_feedback")
    .select("id, section_id, categories, detail, section_content")
    .eq("user_id", userId)
    .eq("template_id", templateId)
    .eq("rating", "down")
    .is("retired_after_streak", null)
    .is("resolved_at", null);

  if (error) {
    logger.error("Failed to fetch active feedback", { error: error.message });
    return [];
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    sectionId: (row.section_id as string) ?? null,
    categories: (row.categories as string[]) ?? [],
    detail: (row.detail as string) ?? "",
    sectionContent: (row.section_content as string) ?? null,
  }));
}

/**
 * Increment clean_streak on all active feedback after a successful
 * generation + persist. Auto-retires entries hitting the threshold (3)
 * and purges PHI (source_snapshot).
 *
 * Fire-and-forget — logs errors but never throws.
 */
export async function incrementCleanStreaks(
  supabase: SupabaseClient,
  userId: string,
  templateId: string,
  renderedSectionIds: string[],
): Promise<void> {
  const { error } = await supabase.rpc("increment_feedback_streaks", {
    p_user_id: userId,
    p_template_id: templateId,
    p_section_ids: renderedSectionIds,
  });

  if (error) {
    logger.error("Failed to increment feedback streaks", {
      error: error.message,
    });
  }
}

// ── Format helpers ────────────────────────────────────────────────

/** Max feedback entries injected per section. */
const MAX_ENTRIES_PER_SECTION = 3;

/**
 * Build per-section feedback prompt blocks from raw feedback entries.
 *
 * Priority: section-specific first, global fills remaining slots.
 * Hard cap of 3 total entries per section.
 *
 * Returns a Map<sectionId, promptBlock> — only sections with feedback
 * are included (callers check `.has(sectionId)`).
 */
export function buildFeedbackMap(
  feedback: ActiveFeedback[],
  sectionIds: string[],
): Map<string, string> {
  if (feedback.length === 0) return new Map();

  const sectionSpecific = feedback.filter((f) => f.sectionId !== null);
  const globals = feedback.filter((f) => f.sectionId === null);

  const result = new Map<string, string>();

  for (const sectionId of sectionIds) {
    const specific = sectionSpecific.filter((f) => f.sectionId === sectionId);
    const remaining = MAX_ENTRIES_PER_SECTION - specific.length;
    const globalSlice = remaining > 0 ? globals.slice(0, remaining) : [];
    const entries = [...specific, ...globalSlice];

    if (entries.length === 0) continue;

    const lines = entries.map((e) => formatFeedbackEntry(e));
    result.set(sectionId, `# Prior corrections\n${lines.join("\n")}`);
  }

  return result;
}
