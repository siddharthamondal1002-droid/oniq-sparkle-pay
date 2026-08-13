REVOKE SELECT (is_admin, oniq_pay_enabled) ON public.profiles FROM authenticated, anon, PUBLIC;
REVOKE SELECT ON public.profiles FROM authenticated, anon;
GRANT SELECT (id, username, display_name, avatar_url, bio, language, created_at, updated_at, show_view_identity) ON public.profiles TO authenticated;