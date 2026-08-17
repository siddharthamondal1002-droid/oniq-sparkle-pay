-- Defense in depth: ensure privileged columns are unreadable/unwritable by app roles
REVOKE ALL (is_admin, oniq_pay_enabled) ON public.profiles FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.profiles_guard_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    IF NEW.is_admin IS DISTINCT FROM OLD.is_admin
       OR NEW.oniq_pay_enabled IS DISTINCT FROM OLD.oniq_pay_enabled THEN
      RAISE EXCEPTION 'Not allowed to modify privileged profile flags';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_privileged_columns_trg ON public.profiles;
CREATE TRIGGER profiles_guard_privileged_columns_trg
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_privileged_columns();
