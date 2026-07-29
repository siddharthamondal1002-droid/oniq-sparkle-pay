CREATE TABLE IF NOT EXISTS public.profiles_private (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  upi_vpa text,
  date_of_birth date,
  is_minor boolean NOT NULL DEFAULT false,
  parent_name text,
  parent_email text,
  parent_phone text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.profiles_private TO authenticated;
GRANT UPDATE (upi_vpa, updated_at) ON public.profiles_private TO authenticated;
GRANT ALL ON public.profiles_private TO service_role;

ALTER TABLE public.profiles_private ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_private_select_own ON public.profiles_private;
CREATE POLICY profiles_private_select_own ON public.profiles_private
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS profiles_private_insert_own ON public.profiles_private;
CREATE POLICY profiles_private_insert_own ON public.profiles_private
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS profiles_private_update_own ON public.profiles_private;
CREATE POLICY profiles_private_update_own ON public.profiles_private
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

INSERT INTO public.profiles_private (user_id, upi_vpa, date_of_birth, is_minor, parent_name, parent_email, parent_phone)
SELECT id, upi_vpa, date_of_birth, is_minor, parent_name, parent_email, parent_phone
FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ensure_profile_private()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles_private (user_id) VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.ensure_profile_private() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ensure_profile_private ON public.profiles;
CREATE TRIGGER trg_ensure_profile_private
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.ensure_profile_private();

CREATE OR REPLACE FUNCTION public.prevent_is_minor_self_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.is_minor IS DISTINCT FROM OLD.is_minor
     AND OLD.date_of_birth IS NOT NULL
     AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'is_minor cannot be changed after signup' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.prevent_is_minor_self_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_prevent_is_minor_self_change ON public.profiles;
DROP TRIGGER IF EXISTS trg_prevent_is_minor_self_change ON public.profiles_private;
CREATE TRIGGER trg_prevent_is_minor_self_change
BEFORE UPDATE ON public.profiles_private
FOR EACH ROW EXECUTE FUNCTION public.prevent_is_minor_self_change();

DROP FUNCTION IF EXISTS public.get_my_profile_private();
CREATE OR REPLACE FUNCTION public.get_my_profile_private()
RETURNS TABLE(
  upi_vpa text,
  oniq_pay_enabled boolean,
  date_of_birth date,
  is_minor boolean,
  parent_name text,
  parent_email text,
  parent_phone text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT pp.upi_vpa, p.oniq_pay_enabled,
         pp.date_of_birth, pp.is_minor, pp.parent_name, pp.parent_email, pp.parent_phone
  FROM public.profiles p
  LEFT JOIN public.profiles_private pp ON pp.user_id = p.id
  WHERE p.id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_profile_private() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile_private() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_signup_profile(_dob date, _parent_name text DEFAULT NULL::text, _parent_email text DEFAULT NULL::text, _parent_phone text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  me uuid := auth.uid();
  minor boolean;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _dob IS NULL OR _dob > current_date OR _dob < '1900-01-01' THEN
    RAISE EXCEPTION 'invalid date of birth';
  END IF;
  minor := ((current_date - _dob) < (18 * 365 + 4));
  IF minor THEN
    IF coalesce(trim(_parent_name),'') = '' OR coalesce(trim(_parent_email),'') = '' THEN
      RAISE EXCEPTION 'parent name and email required for users under 18';
    END IF;
    IF _parent_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RAISE EXCEPTION 'invalid parent email';
    END IF;
  END IF;

  INSERT INTO public.profiles_private (user_id, date_of_birth, is_minor, parent_name, parent_email, parent_phone)
  VALUES (
    me, _dob, minor,
    CASE WHEN minor THEN trim(_parent_name)  ELSE NULL END,
    CASE WHEN minor THEN lower(trim(_parent_email)) ELSE NULL END,
    CASE WHEN minor THEN NULLIF(trim(_parent_phone),'') ELSE NULL END
  )
  ON CONFLICT (user_id) DO UPDATE SET
    date_of_birth = EXCLUDED.date_of_birth,
    is_minor      = EXCLUDED.is_minor,
    parent_name   = EXCLUDED.parent_name,
    parent_email  = EXCLUDED.parent_email,
    parent_phone  = EXCLUDED.parent_phone,
    updated_at    = now();

  UPDATE public.profiles SET updated_at = now() WHERE id = me;
  RETURN jsonb_build_object('is_minor', minor);
END; $$;
REVOKE EXECUTE ON FUNCTION public.set_signup_profile(date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_signup_profile(date, text, text, text) TO authenticated;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS upi_vpa,
  DROP COLUMN IF EXISTS date_of_birth,
  DROP COLUMN IF EXISTS is_minor,
  DROP COLUMN IF EXISTS parent_name,
  DROP COLUMN IF EXISTS parent_email,
  DROP COLUMN IF EXISTS parent_phone;