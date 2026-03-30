-- Audit Logging for GDPR/HIPAA Compliance

CREATE TABLE public.audit_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id         uuid NOT NULL,
  actor_email      text,
  action           text NOT NULL,
  resource_type    text,
  resource_id      text,
  metadata         jsonb DEFAULT '{}',
  ip_address       text,
  is_impersonation boolean DEFAULT false,
  target_user_id   uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_actor    ON public.audit_logs(actor_id, created_at DESC);
CREATE INDEX idx_audit_action   ON public.audit_logs(action, created_at DESC);
CREATE INDEX idx_audit_resource ON public.audit_logs(resource_type, resource_id);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
-- No user-facing RLS policies — only service role (admin client) can insert/read
