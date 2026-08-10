REVOKE SELECT (is_admin, oniq_pay_enabled) ON public.profiles FROM authenticated, anon;

COMMENT ON COLUMN public.profiles.is_admin IS
  'Admin flag. Never selectable by anon/authenticated - read only via the SECURITY DEFINER is_admin(_uid) RPC or service_role.';