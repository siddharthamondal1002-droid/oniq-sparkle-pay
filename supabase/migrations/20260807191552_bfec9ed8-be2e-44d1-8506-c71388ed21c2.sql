DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated, public', r.sig);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.get_my_profile_meta() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_my_profile_meta() TO authenticated;