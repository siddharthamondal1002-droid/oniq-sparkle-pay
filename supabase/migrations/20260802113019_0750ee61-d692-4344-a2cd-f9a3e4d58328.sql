-- Stop exposing the payments flag to every authenticated user.
-- Owners read it via public.get_my_profile_private() (SECURITY DEFINER),
-- and service_role retains full access for backend flows.
REVOKE SELECT (oniq_pay_enabled) ON public.profiles FROM authenticated;
REVOKE UPDATE (oniq_pay_enabled) ON public.profiles FROM authenticated;
REVOKE SELECT (oniq_pay_enabled), UPDATE (oniq_pay_enabled) ON public.profiles FROM anon;

GRANT SELECT (oniq_pay_enabled), UPDATE (oniq_pay_enabled) ON public.profiles TO service_role;