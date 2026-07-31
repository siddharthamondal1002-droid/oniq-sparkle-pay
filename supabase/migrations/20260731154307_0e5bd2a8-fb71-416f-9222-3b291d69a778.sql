CREATE OR REPLACE FUNCTION public.partner_applications_guard_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.verification_status := 'pending';
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN
    RAISE EXCEPTION 'only an administrator can change application status'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'cannot reassign an application' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS partner_applications_guard_status ON public.partner_applications;
CREATE TRIGGER partner_applications_guard_status
BEFORE INSERT OR UPDATE ON public.partner_applications
FOR EACH ROW EXECUTE FUNCTION public.partner_applications_guard_status();