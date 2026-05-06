-- RPC: Increment clean_streak on active negative feedback after successful
-- generation + persist. Auto-retires entries hitting the threshold (3)
-- and purges PHI (source_snapshot).
CREATE OR REPLACE FUNCTION increment_feedback_streaks(
  p_user_id uuid,
  p_template_id text,
  p_section_ids text[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Enforce caller identity: p_user_id must match the authenticated user
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'user_id mismatch';
  END IF;
  -- Step 1: Increment streak for all active feedback on rendered sections
  UPDATE section_feedback
  SET clean_streak = clean_streak + 1
  WHERE user_id = p_user_id
    AND template_id = p_template_id
    AND (section_id = ANY(p_section_ids) OR section_id IS NULL)
    AND rating = 'down'
    AND retired_after_streak IS NULL
    AND resolved_at IS NULL;

  -- Step 2: Auto-retire entries that hit the threshold + purge PHI
  UPDATE section_feedback
  SET retired_after_streak = clean_streak,
      source_snapshot = NULL,
      processed_at = now()
  WHERE user_id = p_user_id
    AND template_id = p_template_id
    AND clean_streak >= 3
    AND retired_after_streak IS NULL
    AND resolved_at IS NULL;
END;
$$;
