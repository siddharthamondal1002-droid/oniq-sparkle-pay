-- 1. profiles: keep column-level protection, make policy intent explicit
DROP POLICY IF EXISTS profiles_select_public_columns ON public.profiles;
CREATE POLICY profiles_select_public_columns ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
COMMENT ON POLICY profiles_select_public_columns ON public.profiles IS
  'Row visibility only. Column exposure is restricted by column-level GRANTs: authenticated may read id, username, display_name, avatar_url, bio, country_code, language, created_at, updated_at, last_policy_notice_at, show_view_identity. is_admin and oniq_pay_enabled are granted to service_role only.';
REVOKE ALL ON public.profiles FROM anon, PUBLIC;
REVOKE SELECT (is_admin, oniq_pay_enabled) ON public.profiles FROM authenticated, anon, PUBLIC;
REVOKE UPDATE (is_admin, oniq_pay_enabled) ON public.profiles FROM authenticated, anon, PUBLIC;

-- 2. conversation_members: owner-scoped self-management, no privilege edits
CREATE POLICY conv_members_update_own ON public.conversation_members
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY conv_members_delete_own ON public.conversation_members
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());
REVOKE UPDATE ON public.conversation_members FROM authenticated;
GRANT UPDATE (last_read_at) ON public.conversation_members TO authenticated;
GRANT DELETE ON public.conversation_members TO authenticated;

-- 3. content_views: writes are RPC-only by design; make the denial explicit
CREATE POLICY content_views_insert_denied ON public.content_views
  FOR INSERT TO authenticated, anon
  WITH CHECK (false);
REVOKE INSERT, UPDATE, DELETE ON public.content_views FROM authenticated, anon, PUBLIC;
