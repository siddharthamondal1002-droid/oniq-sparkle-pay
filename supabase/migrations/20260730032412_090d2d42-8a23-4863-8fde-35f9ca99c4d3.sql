REVOKE ALL ON FUNCTION public.has_active_legal_hold(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_active_legal_hold(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.log_moderation_action(_action text, _target_type text, _target_id text, _reason text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'audit', 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  PERFORM audit.log_moderation(_action, _target_type, _target_id, _reason);
END;
$function$;
REVOKE ALL ON FUNCTION public.log_moderation_action(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_moderation_action(text, text, text, text) TO authenticated, service_role;