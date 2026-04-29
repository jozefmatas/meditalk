# Doctor Feedback Loops — Implementation Plan

## Decisions Summary

| # | Question | Decision |
|---|----------|----------|
| 1 | Primary signal | Explicit feedback (thumbs up/down + categories + detail text) |
| 2 | UI placement | Global at top of note (always visible) + per-section thumbs inline. Thumbs-down → modal. Replace unused delete button. |
| 3 | Categories | 7 fixed categories (multi-select) + per-selection text area: `hallucination`, `missing-info`, `wrong-section`, `style`, `medical-accuracy`, `redundant`, `other` |
| 4 | Data model | Single `section_feedback` table. `section_id = NULL` for global. Source snapshot at feedback time, PHI-purged after processing. |
| 5 | Learning mechanism | Automated negative example injection into section-agent + critic prompts. Per-doctor immediate; global via admin dashboard + pipeline fixes. |
| 6 | Injection scope | Both section-agent + critic for thumbs-down sections. Per-template with per-doctor overlay. Max 3 entries per section (~300 tokens). |
| 7 | Expiry | Streak-based: 3 consecutive clean generations auto-retire. Admin can manually retire via `resolved_at`. New thumbs-down resets streak. |
| 8 | Streak counter | Column on `section_feedback` (`clean_streak`). Batch UPDATE after each generation. |

---

## Phase 1 — Data Model + API

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

## Phase 2 — Feedback UI

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

### Files to modify:
- New: `web/src/components/encounters/feedback-modal.tsx`
- New: `web/src/components/encounters/section-feedback.tsx`
- New: `web/src/components/encounters/note-feedback-bar.tsx`
- Modify: section rendering in note review to include per-section thumbs
- Modify: note review page to include global feedback bar at top

---

## Phase 3 — Pipeline Integration (Negative Example Injection)

### Feedback query at generation time

New module: `web/src/lib/pipeline/feedback.ts`

```typescript
interface ActiveFeedback {
  sectionId: string;
  categories: string[];
  detail: string;
  sectionContent: string; // what was wrong
}

// Query active negative feedback for injection
async function getActiveFeedback(
  supabase: SupabaseClient,
  userId: string,
  templateId: string,
  sectionIds: string[],
): Promise<Map<string, ActiveFeedback[]>>

// Format feedback into prompt block
function formatFeedbackBlock(feedback: ActiveFeedback[]): string

// Increment streak after successful generation
async function incrementCleanStreaks(
  supabase: SupabaseClient,
  userId: string,
  templateId: string,
  renderedSectionIds: string[],
): Promise<void>
```

### Integration points

1. **`session.ts`** — after template resolution, before section loop: query active feedback for `(userId, templateId)`. Pass feedback map into `generateNote`.

2. **`section-agent.ts` (`renderSection`)** — if feedback exists for this section, append `# Prior corrections` block to system prompt. Format: category + what was generated + doctor's explanation.

3. **`critic.ts` (`criticPass`)** — same injection into critic system prompt. Critic sees "Doctor previously flagged [hallucination]: generated X, doctor said Y."

4. **`session.ts`** — after successful generation + persist: fire-and-forget `incrementCleanStreaks()`. Auto-retire entries where `clean_streak >= 3`.

### Streak logic

After each generation:
```sql
-- Increment streak for all active feedback on rendered sections
UPDATE section_feedback
SET clean_streak = clean_streak + 1
WHERE user_id = $1 AND template_id = $2
  AND section_id = ANY($3)
  AND rating = 'down'
  AND retired_after_streak IS NULL
  AND resolved_at IS NULL;

-- Auto-retire entries that hit the threshold
UPDATE section_feedback
SET retired_after_streak = clean_streak
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

---

## Phase 4 — PHI Lifecycle

- At feedback submission: snapshot source into `source_snapshot` jsonb
- Processing (manual review or future automation): extract lesson → update pipeline (contract, fixture, reconciler, etc.)
- After processing: `UPDATE section_feedback SET processed_at = now(), source_snapshot = NULL WHERE id = $1`
- Cron/scheduled job: flag unprocessed feedback older than 30 days for review

---

## NOT in V1 (future)

- Admin dashboard for feedback aggregation (per template × section heatmap)
- Global (cross-doctor) feedback injection — V1 is per-doctor only
- Automated fixture generation from feedback
- Style profile system (per-doctor preferences injected as corpus)
- Implicit feedback via edit diffs (doctors edit in NIS, not reliable)

---

## Verification

After each phase:
1. `cd web && npx vitest run` — all tests pass
2. `npm run lint` — no errors
3. `npm run build` — no type errors
