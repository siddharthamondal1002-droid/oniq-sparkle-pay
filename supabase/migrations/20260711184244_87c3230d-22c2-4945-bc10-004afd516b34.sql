-- Restrict sensitive payment identifier columns on profiles from broad SELECT.
-- The profiles_select_all policy remains for non-sensitive fields (username,
-- display_name, avatar_url, etc.). Owners read their own payment identifiers
-- via the SECURITY DEFINER RPC public.get_my_profile_private().
REVOKE SELECT (upi_vpa, omiq_wallet_address, oniq_pay_enabled) ON public.profiles FROM anon, authenticated;