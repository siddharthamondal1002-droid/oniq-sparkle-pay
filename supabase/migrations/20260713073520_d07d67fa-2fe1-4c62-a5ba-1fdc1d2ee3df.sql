
-- 1) Restrict SELECT on sensitive profile columns via column-level GRANTs
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (id, username, display_name, avatar_url, bio, country_code, language, is_admin, last_policy_notice_at, created_at, updated_at) ON public.profiles TO authenticated;
-- upi_vpa, omiq_wallet_address, oniq_pay_enabled remain readable only by service_role and via the SECURITY DEFINER RPC get_my_profile_private (owner-only)

-- 2) Scope follows visibility to the involved users only
DROP POLICY IF EXISTS follows_select_all ON public.follows;
CREATE POLICY follows_select_involved ON public.follows
  FOR SELECT TO authenticated
  USING (follower_id = auth.uid() OR followee_id = auth.uid());

-- 3) Revoke EXECUTE on SECURITY DEFINER functions from anon/public
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
-- Re-grant to authenticated so app calls keep working; service_role already bypasses
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
