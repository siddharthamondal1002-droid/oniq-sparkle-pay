-- 1. Guard function: is this user's HOME country one where health data is allowed?
-- Home is profiles.country_code only. Never current region. NULL / unknown is
-- allowed (only 'AE' is blocked) so no other country becomes more restricted.
CREATE OR REPLACE FUNCTION public.health_data_allowed(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT upper(trim(coalesce(p.country_code,''))) <> 'AE'
     FROM public.profiles p WHERE p.id = _user_id),
    true);
$$;

GRANT EXECUTE ON FUNCTION public.health_data_allowed(uuid) TO authenticated, service_role;

-- 2. Write guard trigger — refuses inserts/updates for AE-home profiles.
CREATE OR REPLACE FUNCTION public.health_write_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.health_data_allowed(NEW.user_id) THEN
    RAISE EXCEPTION 'health data collection is not available in your country'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS health_checkins_ae_guard ON public.health_checkins;
CREATE TRIGGER health_checkins_ae_guard
  BEFORE INSERT OR UPDATE ON public.health_checkins
  FOR EACH ROW EXECUTE FUNCTION public.health_write_guard();

DROP TRIGGER IF EXISTS cycle_logs_ae_guard ON public.cycle_logs;
CREATE TRIGGER cycle_logs_ae_guard
  BEFORE INSERT OR UPDATE ON public.cycle_logs
  FOR EACH ROW EXECUTE FUNCTION public.health_write_guard();

DROP TRIGGER IF EXISTS health_profiles_ae_guard ON public.health_profiles;
CREATE TRIGGER health_profiles_ae_guard
  BEFORE INSERT OR UPDATE ON public.health_profiles
  FOR EACH ROW EXECUTE FUNCTION public.health_write_guard();

-- 3. Additive RESTRICTIVE policies: belt and braces at the RLS layer.
-- RESTRICTIVE policies only narrow; no existing permissive policy is changed.
DROP POLICY IF EXISTS "no health writes for AE home" ON public.health_checkins;
CREATE POLICY "no health writes for AE home" ON public.health_checkins
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (true)
  WITH CHECK (public.health_data_allowed(user_id));

DROP POLICY IF EXISTS "no health writes for AE home" ON public.cycle_logs;
CREATE POLICY "no health writes for AE home" ON public.cycle_logs
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (true)
  WITH CHECK (public.health_data_allowed(user_id));

DROP POLICY IF EXISTS "no health writes for AE home" ON public.health_profiles;
CREATE POLICY "no health writes for AE home" ON public.health_profiles
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (true)
  WITH CHECK (public.health_data_allowed(user_id));

-- 4. Purge any existing health rows for AE-home profiles (0 at time of writing).
DELETE FROM public.health_checkins h
  USING public.profiles p
  WHERE p.id = h.user_id AND upper(trim(coalesce(p.country_code,''))) = 'AE';
DELETE FROM public.cycle_logs h
  USING public.profiles p
  WHERE p.id = h.user_id AND upper(trim(coalesce(p.country_code,''))) = 'AE';
DELETE FROM public.health_profiles h
  USING public.profiles p
  WHERE p.id = h.user_id AND upper(trim(coalesce(p.country_code,''))) = 'AE';

-- 5. Self-serve purge used when a user switches Home to AE.
CREATE OR REPLACE FUNCTION public.purge_my_health_data()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE me uuid := auth.uid(); n integer := 0; c integer;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  DELETE FROM public.cycle_logs WHERE user_id = me;      GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  DELETE FROM public.health_checkins WHERE user_id = me; GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  DELETE FROM public.health_profiles WHERE user_id = me; GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_my_health_data() TO authenticated;