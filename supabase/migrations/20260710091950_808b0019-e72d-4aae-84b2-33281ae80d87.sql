-- Restrict payment identifiers on profiles to owner-only access via column privileges.
REVOKE SELECT ON public.profiles FROM authenticated;
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (id, username, display_name, avatar_url, bio, country_code, language, created_at, updated_at, is_admin, last_policy_notice_at) ON public.profiles TO authenticated;
GRANT SELECT (id, username, display_name, avatar_url, bio, country_code, language, created_at, updated_at) ON public.profiles TO anon;
-- Owners can still read their own upi_vpa / omiq_wallet_address / oniq_pay_enabled through the existing
-- SECURITY DEFINER function public.get_my_profile_private(), which is scoped to auth.uid().