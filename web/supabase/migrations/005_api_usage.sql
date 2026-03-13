-- API Usage Tracking for Admin Dashboard

CREATE TABLE public.api_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  visit_id uuid REFERENCES public.visits(id) ON DELETE SET NULL,
  provider text NOT NULL,
  model text NOT NULL,
  operation text NOT NULL,
  input_tokens int DEFAULT 0,
  output_tokens int DEFAULT 0,
  cost_usd numeric(10,6) DEFAULT 0,
  duration_seconds numeric(8,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_usage_user ON public.api_usage(user_id, created_at DESC);
CREATE INDEX idx_api_usage_created ON public.api_usage(created_at DESC);

ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage"
  ON public.api_usage FOR SELECT USING (auth.uid() = user_id);
