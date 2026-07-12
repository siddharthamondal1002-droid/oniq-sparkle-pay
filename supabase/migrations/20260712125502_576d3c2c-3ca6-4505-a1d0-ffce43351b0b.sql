-- Column-level REVOKE has no effect while table-level SELECT is granted.
-- Revoke table-level SELECT and re-grant only the non-sensitive columns.
REVOKE SELECT ON public.profiles FROM anon, authenticated;

GRANT SELECT (
  id, username, display_name, avatar_url, bio,
  country_code, language, created_at, updated_at, last_policy_notice_at
) ON public.profiles TO authenticated;

-- Owners read their own upi_vpa / omiq_wallet_address / oniq_pay_enabled
-- through public.get_my_profile_private() (SECURITY DEFINER).