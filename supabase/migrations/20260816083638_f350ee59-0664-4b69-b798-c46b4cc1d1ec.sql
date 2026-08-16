REVOKE ALL ON public.profiles FROM anon, authenticated, PUBLIC;

GRANT SELECT (
  id, username, display_name, avatar_url, bio,
  country_code, language, created_at, updated_at,
  last_policy_notice_at, show_view_identity
) ON public.profiles TO authenticated;

GRANT INSERT (id, username, display_name, avatar_url, bio, country_code, language)
  ON public.profiles TO authenticated;
GRANT UPDATE (
  username, display_name, avatar_url, bio,
  country_code, language, last_policy_notice_at, show_view_identity
) ON public.profiles TO authenticated;

GRANT ALL ON public.profiles TO service_role;

DROP POLICY IF EXISTS profiles_select_all ON public.profiles;
CREATE POLICY profiles_select_public_columns ON public.profiles
  FOR SELECT TO authenticated USING (true);

COMMENT ON POLICY profiles_select_public_columns ON public.profiles IS
  'Any signed-in user may read public profile columns. is_admin and oniq_pay_enabled are NOT granted to authenticated/anon and must be read through security-definer functions (is_admin, get_my_profile_meta).';