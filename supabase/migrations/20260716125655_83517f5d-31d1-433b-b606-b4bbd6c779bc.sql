-- Harden profiles.is_admin against privilege escalation.
-- Existing BEFORE UPDATE triggers already reject non-admin is_admin changes;
-- this adds column-level defense-in-depth and a proper WITH CHECK on the
-- update policy so the security advisor rule is satisfied.

REVOKE UPDATE (is_admin) ON public.profiles FROM authenticated;
REVOKE UPDATE (is_admin) ON public.profiles FROM anon;
GRANT UPDATE (is_admin) ON public.profiles TO service_role;

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
