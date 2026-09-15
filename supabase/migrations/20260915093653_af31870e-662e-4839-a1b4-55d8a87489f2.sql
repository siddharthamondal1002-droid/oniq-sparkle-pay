-- 1) menu_items: no owner model exists for restaurants, so writes belong to
--    trusted backend only. RLS already denied these (no write policies), but
--    the table-level grants were a single point of failure. Revoke them.
REVOKE INSERT, UPDATE, DELETE ON public.menu_items FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.menu_items FROM authenticated;
GRANT SELECT ON public.menu_items TO anon, authenticated;
GRANT ALL ON public.menu_items TO service_role;

-- 2) profiles: the row policy is intentionally directory-wide, so the column
--    allowlist is what protects sensitive fields. Make it explicit rather than
--    incidental: revoke everything, then re-grant only the public columns.
REVOKE SELECT ON public.profiles FROM anon;
REVOKE SELECT ON public.profiles FROM authenticated;
REVOKE ALL (is_admin, oniq_pay_enabled) ON public.profiles FROM anon;
REVOKE ALL (is_admin, oniq_pay_enabled) ON public.profiles FROM authenticated;

GRANT SELECT (
  id,
  username,
  display_name,
  avatar_url,
  bio,
  country_code,
  language,
  created_at,
  updated_at,
  last_policy_notice_at,
  show_view_identity
) ON public.profiles TO authenticated;

GRANT ALL ON public.profiles TO service_role;

-- 3) content_views: the legitimate insert path is the SECURITY DEFINER RPC
--    public.record_channel_views, which forces viewer_id = auth.uid() and
--    validates the message belongs to the channel. Keep direct inserts denied
--    and make the RPC grant explicit; anon must not reach it.
REVOKE INSERT, UPDATE, DELETE ON public.content_views FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.content_views FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.record_channel_views(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_channel_views(uuid, uuid[]) TO authenticated;
GRANT SELECT ON public.content_views TO authenticated;
GRANT ALL ON public.content_views TO service_role;