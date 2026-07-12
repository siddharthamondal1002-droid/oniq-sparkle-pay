-- Prevent privilege escalation via profiles.is_admin self-update.
-- The profiles_update_own RLS policy allows users to update their own row;
-- this trigger blocks any change to the is_admin column unless the caller is
-- already an admin (checked via the existing public.is_admin function).
-- SECURITY DEFINER + fixed search_path so it runs consistently under RLS.

CREATE OR REPLACE FUNCTION public.profiles_prevent_privileged_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin
     AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not permitted to modify admin flag'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_prevent_privileged_change ON public.profiles;
CREATE TRIGGER profiles_prevent_privileged_change
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.profiles_prevent_privileged_change();

-- Belt-and-braces: revoke column-level UPDATE on is_admin from ordinary roles.
-- Table-level UPDATE grants remain for the other columns.
REVOKE UPDATE (is_admin) ON public.profiles FROM authenticated;
REVOKE UPDATE (is_admin) ON public.profiles FROM anon;