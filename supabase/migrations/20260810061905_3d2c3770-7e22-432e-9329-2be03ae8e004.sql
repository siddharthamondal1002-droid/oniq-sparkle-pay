-- Remove blanket INSERT/UPDATE which allowed writing privileged columns
REVOKE INSERT, UPDATE ON public.profiles FROM authenticated, anon;

-- Re-grant only safe columns
GRANT INSERT (id, username, display_name, avatar_url, bio, country_code, language, updated_at, last_policy_notice_at, show_view_identity)
  ON public.profiles TO authenticated;
GRANT UPDATE (username, display_name, avatar_url, bio, country_code, language, updated_at, last_policy_notice_at, show_view_identity)
  ON public.profiles TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO service_role;

-- Defense in depth: never let a non-admin enable payments
CREATE OR REPLACE FUNCTION public.profiles_guard_oniq_pay()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.oniq_pay_enabled IS TRUE AND NOT public.is_admin(auth.uid()) THEN
      NEW.oniq_pay_enabled := false;
    END IF;
  ELSE
    IF NEW.oniq_pay_enabled IS DISTINCT FROM OLD.oniq_pay_enabled
       AND NOT public.is_admin(auth.uid()) THEN
      NEW.oniq_pay_enabled := OLD.oniq_pay_enabled;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.profiles_guard_oniq_pay() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_guard_oniq_pay ON public.profiles;
CREATE TRIGGER profiles_guard_oniq_pay
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_oniq_pay();