-- Trigger function: copy login/logout events from auth.audit_log_entries
-- into public.audit_logs so they appear alongside our app-level audit trail.
CREATE OR REPLACE FUNCTION public.handle_auth_audit_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
BEGIN
  v_action := NEW.payload->>'action';

  -- Only capture login and logout, not token_refreshed etc.
  IF v_action NOT IN ('login', 'logout') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.audit_logs (
    actor_id,
    actor_email,
    action,
    ip_address,
    metadata
  ) VALUES (
    (NEW.payload->>'actor_id')::uuid,
    NEW.payload->>'actor_username',
    'auth.' || v_action,
    NEW.ip_address,
    jsonb_build_object(
      'log_type', NEW.payload->>'log_type',
      'via_sso',  NEW.payload->>'actor_via_sso'
    )
  );

  RETURN NEW;
END;
$$;

-- Fire after every insert on Supabase's built-in auth audit table
CREATE TRIGGER on_auth_audit_event
  AFTER INSERT ON auth.audit_log_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_auth_audit_event();
