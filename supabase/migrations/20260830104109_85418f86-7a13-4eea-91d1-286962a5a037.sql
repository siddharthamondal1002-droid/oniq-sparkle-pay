REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (id, username, display_name, avatar_url, bio, country_code, language, created_at, updated_at, last_policy_notice_at, show_view_identity) ON public.profiles TO authenticated;
NOTIFY pgrst, 'reload schema';