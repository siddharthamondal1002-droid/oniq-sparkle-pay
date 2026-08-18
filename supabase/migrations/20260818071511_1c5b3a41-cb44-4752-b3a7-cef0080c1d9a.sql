-- Restrict readable columns on profiles to safe public fields only.
REVOKE SELECT ON public.profiles FROM anon, authenticated;

GRANT SELECT (id, username, display_name, avatar_url, bio, country_code, language, show_view_identity, created_at, updated_at)
  ON public.profiles TO authenticated;

-- Sensitive flags remain ungranted to client roles.
REVOKE SELECT (is_admin, oniq_pay_enabled, last_policy_notice_at) ON public.profiles FROM anon, authenticated;

-- Replace the wide-open read policy with an explicit authenticated-only one.
DROP POLICY IF EXISTS profiles_select_public_columns ON public.profiles;
CREATE POLICY profiles_select_public_columns
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

GRANT ALL ON public.profiles TO service_role;