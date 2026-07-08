
-- 1) Column-level: revoke SELECT on sensitive profile columns from anon/authenticated.
--    Owner access continues via SECURITY DEFINER function public.get_my_profile_private().
REVOKE SELECT (upi_vpa, omiq_wallet_address, oniq_pay_enabled) ON public.profiles FROM authenticated;
REVOKE SELECT (upi_vpa, omiq_wallet_address, oniq_pay_enabled) ON public.profiles FROM anon;

-- 2) Revoke EXECUTE from anon (and PUBLIC) on all SECURITY DEFINER functions in public schema.
--    All app callers are authenticated; anon should never call these.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon;',
                   r.nspname, r.proname, r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated, service_role;',
                   r.nspname, r.proname, r.args);
  END LOOP;
END $$;
