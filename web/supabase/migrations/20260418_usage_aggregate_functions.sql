-- Aggregate usage stats via SQL to avoid Supabase's 1000-row default limit.
-- All functions are STABLE (read-only) for optimizer friendliness.

-- Per-user totals (users list + user detail)
CREATE OR REPLACE FUNCTION aggregate_usage_by_user()
RETURNS TABLE(user_id uuid, requests bigint, total_cost numeric)
LANGUAGE sql STABLE
AS $$
  SELECT user_id, COUNT(*), COALESCE(SUM(cost_usd), 0)
  FROM api_usage
  GROUP BY user_id;
$$;

-- Per-visit totals (encounters list + user encounters)
CREATE OR REPLACE FUNCTION aggregate_usage_by_visit()
RETURNS TABLE(visit_id uuid, requests bigint, total_cost numeric)
LANGUAGE sql STABLE
AS $$
  SELECT visit_id, COUNT(*), COALESCE(SUM(cost_usd), 0)
  FROM api_usage
  WHERE visit_id IS NOT NULL
  GROUP BY visit_id;
$$;

-- Dashboard totals (single row)
CREATE OR REPLACE FUNCTION get_dashboard_usage_totals()
RETURNS TABLE(
  total_cost numeric,
  total_requests bigint,
  total_input_tokens bigint,
  total_output_tokens bigint,
  unique_visit_count bigint,
  total_recording_seconds numeric
)
LANGUAGE sql STABLE
AS $$
  SELECT
    COALESCE(SUM(cost_usd), 0),
    COUNT(*),
    COALESCE(SUM(input_tokens), 0)::bigint,
    COALESCE(SUM(output_tokens), 0)::bigint,
    COUNT(DISTINCT visit_id),
    COALESCE(SUM(CASE WHEN operation = 'transcribe' THEN duration_seconds ELSE 0 END), 0)
  FROM api_usage;
$$;

-- Dashboard by-model breakdown
CREATE OR REPLACE FUNCTION aggregate_usage_by_model()
RETURNS TABLE(
  provider text,
  model text,
  requests bigint,
  input_tokens bigint,
  output_tokens bigint,
  total_cost numeric,
  total_duration_seconds numeric
)
LANGUAGE sql STABLE
AS $$
  SELECT
    provider,
    model,
    COUNT(*),
    COALESCE(SUM(input_tokens), 0)::bigint,
    COALESCE(SUM(output_tokens), 0)::bigint,
    COALESCE(SUM(cost_usd), 0),
    COALESCE(SUM(duration_seconds), 0)
  FROM api_usage
  GROUP BY provider, model
  ORDER BY SUM(cost_usd) DESC;
$$;

-- Dashboard by-operation breakdown
CREATE OR REPLACE FUNCTION aggregate_usage_by_operation()
RETURNS TABLE(operation text, requests bigint, total_cost numeric)
LANGUAGE sql STABLE
AS $$
  SELECT operation, COUNT(*), COALESCE(SUM(cost_usd), 0)
  FROM api_usage
  GROUP BY operation
  ORDER BY SUM(cost_usd) DESC;
$$;
