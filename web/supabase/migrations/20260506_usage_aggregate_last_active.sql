-- Add last_active to aggregate_usage_by_user so admin "Last Active" shows
-- actual usage time instead of Supabase auth's last_sign_in_at.
-- Must DROP first because CREATE OR REPLACE cannot change return type.

DROP FUNCTION IF EXISTS aggregate_usage_by_user();

CREATE FUNCTION aggregate_usage_by_user()
RETURNS TABLE(user_id uuid, requests bigint, total_cost numeric, last_active timestamptz)
LANGUAGE sql STABLE
AS $$
  SELECT user_id, COUNT(*), COALESCE(SUM(cost_usd), 0), MAX(created_at)
  FROM api_usage
  GROUP BY user_id;
$$;
