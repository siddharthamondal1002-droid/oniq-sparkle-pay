-- B4 support: PostgREST exposes only the public schema, so the audit writer
-- gets a public wrapper, and takedowns get an admin soft-delete that works
-- under RLS (admins cannot UPDATE other users' rows directly — by design).

CREATE OR REPLACE FUNCTION public.log_moderation_action(
  _action text, _target_type text, _target_id text, _reason text DEFAULT NULL
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = audit, public AS $$
  SELECT audit.log_moderation(_action, _target_type, _target_id, _reason);
$$;
REVOKE ALL ON FUNCTION public.log_moderation_action(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_moderation_action(text, text, text, text) TO authenticated;

-- Admin takedown: soft-delete the referenced content and write the audit
-- row atomically. Content bytes/path rotation remain a B1 follow-up.
CREATE OR REPLACE FUNCTION public.admin_takedown_content(_content_type text, _content_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, audit AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF _content_type = 'moment' THEN
    UPDATE public.moments_posts SET is_deleted = true WHERE id = _content_id;
  ELSIF _content_type = 'clip' THEN
    UPDATE public.clips SET is_deleted = true WHERE id = _content_id;
  ELSE
    RAISE EXCEPTION 'unsupported content type for takedown: %', _content_type;
  END IF;
  PERFORM audit.log_moderation('takedown_content', _content_type, _content_id::text, _reason);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_takedown_content(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_takedown_content(text, uuid, text) TO authenticated;