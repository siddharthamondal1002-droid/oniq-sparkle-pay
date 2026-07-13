-- Revoke column-level read access to sensitive fields on profiles
REVOKE SELECT (upi_vpa, omiq_wallet_address, is_admin) ON public.profiles FROM authenticated;
REVOKE SELECT (upi_vpa, omiq_wallet_address, is_admin) ON public.profiles FROM anon;

-- Ensure service_role retains full access
GRANT ALL ON public.profiles TO service_role;

-- Expose is_admin RPC to authenticated callers (already SECURITY DEFINER)
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_profile_private() TO authenticated;
