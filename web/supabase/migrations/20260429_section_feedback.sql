-- Doctor feedback on generated note sections.
-- section_id = NULL represents global (whole-note) feedback.
CREATE TABLE section_feedback (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id        uuid NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id),
  template_id     text NOT NULL REFERENCES templates(id),
  section_id      text,
  section_kind    text,
  rating          text NOT NULL CHECK (rating IN ('up', 'down')),
  categories      text[] DEFAULT '{}',
  detail          text DEFAULT '',
  section_content text,
  source_snapshot jsonb,
  clean_streak    int DEFAULT 0,
  retired_after_streak int,
  resolved_at     timestamptz,
  processed_at    timestamptz,
  created_at      timestamptz DEFAULT now()
);

-- Active negative feedback lookup (used at generation time)
CREATE INDEX idx_section_feedback_active
  ON section_feedback (template_id, section_id, rating)
  WHERE retired_after_streak IS NULL AND resolved_at IS NULL;

-- Per-user feedback listing
CREATE INDEX idx_section_feedback_user
  ON section_feedback (user_id, template_id);

-- Per-visit feedback (UI restore)
CREATE INDEX idx_section_feedback_visit
  ON section_feedback (visit_id, user_id);

-- RLS: users see only their own feedback
ALTER TABLE section_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY section_feedback_owner ON section_feedback
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
