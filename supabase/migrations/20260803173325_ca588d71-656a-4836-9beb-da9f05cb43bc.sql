DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.health_data_allowed(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purge_my_health_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.health_data_allowed(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_my_health_data() TO authenticated;