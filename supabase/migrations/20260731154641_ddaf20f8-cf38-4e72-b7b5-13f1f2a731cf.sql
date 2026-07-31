CREATE OR REPLACE FUNCTION public.profiles_guard_is_admin_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_admin IS TRUE AND NOT public.is_admin(auth.uid()) THEN
    NEW.is_admin := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_is_admin_insert ON public.profiles;
CREATE TRIGGER profiles_guard_is_admin_insert
BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_is_admin_insert();

REVOKE UPDATE (is_admin), INSERT (is_admin) ON public.profiles FROM authenticated, anon;