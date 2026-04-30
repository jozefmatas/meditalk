# Doctor Feedback Loops — Implementation Plan

## Decisions Summary

| # | Question | Decision |
|---|----------|----------|
| 1 | Primary signal | Explicit feedback (thumbs up/down + categories + detail text) |
| 2 | UI placement | Global at top of note (always visible) + per-section thumbs inline. Thumbs-down → modal. Replace unused delete button. |
| 3 | Categories | 7 fixed categories (multi-select) + per-selection text area: `hallucination`, `missing-info`, `wrong-section`, `style`, `medical-accuracy`, `redundant`, `other` |
| 4 | Data model | Single `section_feedback` table. `section_id = NULL` for global. Source snapshot at feedback time, PHI-purged after streak retirement. |
| 5 | Learning mechanism | Automated negative example injection into **section-agent only** (not critic). Per-doctor immediate; global via admin dashboard + pipeline fixes. |
| 6 | Injection scope | Section-agent only for thumbs-down sections. Per-template with per-doctor overlay. Max 3 entries per section (~300 tokens). |
| 7 | Expiry | Streak-based: 3 consecutive clean generations auto-retire. Admin can manually retire via `resolved_at`. New thumbs-down resets streak. |
| 8 | Streak counter | Column on `section_feedback` (`clean_streak`). Batch UPDATE after each successful persist. |

### Phase 3+4 Grilling Decisions

| # | Question | Decision |
|---|----------|----------|
| G1 | Injection target | Section-agent only (not critic) for V1. Critic already has unfounded-denial rules. |
| G2 | Prompt placement | Append `# Prior corrections` block to Block 3 (uncached per-section contract block) |
| G3 | Feedback format | Compact single-line: `- [category] "bad output" → Doctor: "explanation"`. Global entries labeled `[GENERAL]`. Doctor's original language. |
| G4 | Global feedback | Broadcast to all sections. Section-specific takes priority, global fills remaining slots. Labeled `[GENERAL]` so model can weight. |
| G5 | Token cap | Hard cap 3 total per section. Section-specific priority, global fills rest. |
| G6 | Streak timing | After successful persist (not before). Streak only counts when doctor received output. |
| G7 | Feedback query location | New `web/src/lib/pipeline/feedback.ts` module. Session.ts calls once, passes map down. |
| G8 | Adjust injection | No — adjust is explicit one-shot instruction. Feedback injection for unguided generations only (generate, regenerate). |
| G9 | PHI lifecycle | Auto-purge `source_snapshot` when feedback auto-retires (3 clean streaks). No cron needed. |

---

## Phase 1 — Data Model + API ✅ DONE

### Migration: `section_feedback` table

```sql
CREATE TABLE section_feedback (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id      uuid NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id),
  template_id   uuid NOT NULL REFERENCES templates(id),
  section_id    text,              -- NULL = global note feedback
  section_kind  text,              -- e.g. "history-narrative", NULL for global
  rating        text NOT NULL CHECK (rating IN ('up', 'down')),
  categories    text[] DEFAULT '{}',
  detail        text DEFAULT '',
  section_content text,            -- snapshot of generated content at feedback time
  source_snapshot jsonb,           -- transcript + doctorNotes + files (PHI — purge after processing)
  clean_streak  int DEFAULT 0,
  retired_after_streak int,        -- set when auto-retired (e.g. 3)
  resolved_at   timestamptz,       -- admin manual retirement
  processed_at  timestamptz,       -- when lesson extracted + source purged
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_section_feedback_active ON section_feedback (template_id, section_id, rating)
  WHERE retired_after_streak IS NULL AND resolved_at IS NULL;

CREATE INDEX idx_section_feedback_user ON section_feedback (user_id, template_id);
```

### API Route: `POST /api/encounters/[encounterId]/feedback`

- Auth required
- Body: `{ sectionId?: string, sectionKind?: string, rating: "up" | "down", categories?: string[], detail?: string }`
- Fetches encounter to snapshot `section_contents[sectionId]` + source (transcript, doctorNotes, file texts from metadata)
- If rating = "down" on same (user, template, section, category overlap) → reset `clean_streak = 0` on existing active entry
- Insert new row
- Returns `{ id }`

### API Route: `GET /api/encounters/[encounterId]/feedback`

- Auth required
- Returns all feedback for this encounter by current user
- UI uses this to restore thumbs state when revisiting an encounter

---

## Phase 2 — Feedback UI ✅ DONE

### Per-section thumbs (replace delete button)

- Each section header gets thumbs-up / thumbs-down icons
- Thumbs-down opens modal with:
  - Multi-select category chips (7 categories)
  - Per-selected-category text area for detail (like file context dialog pattern)
  - Submit button
- Thumbs-up = single click, no modal, fires `POST` with `rating: "up"`
- State persisted: revisiting encounter shows prior feedback

### Global feedback (top of note)

- Positioned at top of note review area, always visible
- Same thumbs pattern but `sectionId = null`
- "How was this note overall?" framing

### Files created/modified:
- `web/src/components/encounters/feedback-modal.tsx`
- `web/src/components/encounters/section-feedback-row.tsx`
- `web/src/components/encounters/hooks/use-feedback.ts`
- `web/src/components/encounters/review-view.tsx` (integrated global + per-section)
- `web/src/components/encounters/note-section-card.tsx` (per-section thumbs)
- `web/src/components/encounters/note-sections-list.tsx` (feedback props passthrough)

---

## Phase 3 — Pipeline Integration (Negative Example Injection)

### 3a. Feedback query module

New file: `web/src/lib/pipeline/feedback.ts`

```typescript
interface ActiveFeedback {
  id: string;
  sectionId: string | null;  // null = global
  categories: string[];
  detail: string;
  sectionContent: string | null; // what was wrong (null for global)
}

// Query active negative feedback for injection
// Returns section-specific entries + global entries (section_id = null)
async function getActiveFeedback(
  supabase: SupabaseClient,
  userId: string,
  templateId: string,
): Promise<ActiveFeedback[]>

// Build per-section feedback blocks with priority:
// 1. Section-specific entries first
// 2. Global entries fill remaining slots
// 3. Hard cap 3 total per section
// Global entries labeled [GENERAL]
function buildFeedbackMap(
  feedback: ActiveFeedback[],
  sectionIds: string[],
): Map<string, string>  // sectionId → formatted prompt block

// Format single feedback entry into prompt line
// Compact: - [category] "bad output" → Doctor: "explanation"
// Global:  - [GENERAL][category] → Doctor: "explanation"
function formatFeedbackEntry(entry: ActiveFeedback, isGlobal: boolean): string

// Format complete block for a section
function formatFeedbackBlock(entries: ActiveFeedback[]): string
// Returns:
// # Prior corrections
// - [hallucination] "Patient had no allergies" → Doctor: "Patient is allergic to penicillin"
// - [GENERAL][style] → Doctor: "LA had wrong medication dose, TO section was redundant"

// Increment streak after successful generation + persist
async function incrementCleanStreaks(
  supabase: SupabaseClient,
  userId: string,
  templateId: string,
  renderedSectionIds: string[],
): Promise<void>
```

### 3b. Integration points

1. **`session.ts`** — after template resolution, before section loop: call `getActiveFeedback(supabase, userId, templateId)`. Build feedback map via `buildFeedbackMap()`. Pass map into pipeline.

2. **`section-agent.ts` (`renderSection`)** — if feedback block exists for this section, append `# Prior corrections` block to **Block 3** (uncached per-section contract block). NOT to Block 1 or Block 2 (those are cached).

3. **`session.ts`** — after successful generation + persist (fire-and-forget): call `incrementCleanStreaks()`. Auto-retire + purge entries where `clean_streak >= 3`.

4. **NOT injected into:** critic (`critic.ts`), adjust route (`/api/adjust`).

### 3c. Streak logic

After each successful persist:
```sql
-- Increment streak for all active feedback on rendered sections
UPDATE section_feedback
SET clean_streak = clean_streak + 1
WHERE user_id = $1 AND template_id = $2
  AND (section_id = ANY($3) OR section_id IS NULL)
  AND rating = 'down'
  AND retired_after_streak IS NULL
  AND resolved_at IS NULL;

-- Auto-retire entries that hit the threshold + purge PHI
UPDATE section_feedback
SET retired_after_streak = clean_streak,
    source_snapshot = NULL,
    processed_at = now()
WHERE user_id = $1 AND template_id = $2
  AND clean_streak >= 3
  AND retired_after_streak IS NULL
  AND resolved_at IS NULL;
```

New thumbs-down on same (user, template, section) resets streak:
```sql
UPDATE section_feedback
SET clean_streak = 0
WHERE user_id = $1 AND template_id = $2 AND section_id = $3
  AND rating = 'down'
  AND retired_after_streak IS NULL
  AND resolved_at IS NULL;
```

### 3d. Adjust tooltip

After generation completes, show a tooltip on the Adjust button:
- Text: "Something off? Click Adjust to tell MediTalk what to fix." (localized)
- Shows once per session or first N times, then auto-dismisses
- Bridges feedback ("teach forever") with adjust ("fix now")
- Add i18n keys to sk/cs/en message files

### 3e. Regenerate CTA after thumbs-down (V1)

After doctor submits thumbs-down on a section:
- Show inline "Regenerate?" link next to thumbs icons
- On click: compose instruction from categories + detail → call `onAdjustGenerate`
- `SectionFeedbackRow` gets optional `onRegenerate` prop
- Only shown when `rating === "down"`

---

## Phase 4 — PHI Lifecycle

PHI purge is handled automatically by streak retirement (Phase 3c):
- When `clean_streak >= 3` → `source_snapshot = NULL, processed_at = now()`
- Admin can manually retire via `resolved_at` → separate purge if needed
- No cron job needed for V1

For manually resolved entries:
```sql
UPDATE section_feedback
SET resolved_at = now(), source_snapshot = NULL, processed_at = now()
WHERE id = $1;
```

---

## Iteration 1 — Inline Per-Section Feedback UX

Replaces the modal-based per-section thumbs-down flow with inline text buttons + expandable textarea. Global feedback keeps the modal.

### Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Feedback scope | Both — one-shot by default, "Remember for future notes" checkbox opts into DB persistence |
| 2 | Regen path | Direct parameter — `inlineFeedback` passed in `/api/generate` body (no DB round-trip for regen) |
| 3 | Checkbox default | Unchecked — most corrections are patient-specific |
| 4 | Post-regen state | Reset to neutral — doctor actively confirms with "Looks good" |
| 5 | Checkbox visibility | Always visible when textarea is expanded |
| 6 | "Looks good" persistence | Yes, save "up" rating to DB (state restoration + analytics) |
| 7 | Revisit behavior | After regen → clean slate. Unsubmitted draft → sessionStorage restores |
| 8 | Draft persistence | sessionStorage keyed by `visitId-sectionId` |

### What changed

- **`section-feedback-row.tsx`** — rewritten: "Looks good" / "Needs work..." text buttons + expandable textarea + "Remember for future notes" checkbox + sessionStorage draft
- **Per-section modal removed** — `FeedbackModal` now only used for global feedback. Per-section: inline textarea → Submit → auto-regen
- **`/api/generate`** — new `inlineFeedback: { sectionId, text }` param. Pipeline merges it into feedbackMap (prepended, highest priority) without DB round-trip.
- **Categories optional** — per-section inline feedback has no category selection. `categories` defaults to `[]`. `formatFeedbackEntry` handles empty categories gracefully.
- **Single action** — Submit saves (if "Remember" checked) AND triggers section regen in one click. No separate regen button.

---

## NOT in V1 (future)

- Admin dashboard for feedback aggregation (per template × section heatmap)
- Global (cross-doctor) feedback injection — V1 is per-doctor only
- Automated fixture generation from feedback
- Style profile system (per-doctor preferences injected as corpus)
- Implicit feedback via edit diffs (doctors edit in NIS, not reliable)
- Auto-detect patterns from adjust instructions (e.g. "shorter" on same section 5+ times)
- Inject adjust data into future prompts (store for analytics only in V1)
- Critic injection (V1 is section-agent only)

---

## Verification

After each phase:
1. `cd web && npx vitest run` — all tests pass
2. `npm run lint` — no errors
3. `npm run build` — no type errors
