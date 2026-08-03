-- Region signal helper. Reads the edge country header off the current request,
-- decides, and discards it. Nothing is stored; no region column exists.
CREATE OR REPLACE FUNCTION public.health_request_region_ok()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Returns false ONLY on a positive 'AE' signal. Missing/unknown => true,
  -- so a request with no region signal falls back to the Home-based rule.
  SELECT COALESCE(
    upper(trim(COALESCE(
      current_setting('request.headers', true)::json ->> 'cf-ipcountry',
      ''
    ))) <> 'AE',
    true
  );
$$;

REVOKE ALL ON FUNCTION public.health_request_region_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.health_request_region_ok() TO authenticated, service_role;

-- UAE health-data block (Federal Law 2/2019 + Ministerial Resolution 51/2021).
-- The law targets health data GENERATED IN the UAE, so two independent axes
-- must both be clear before a health row may be written:
--
--   HOME axis   -> profiles.country_code. FAILS OPEN: an unknown/null home
--                  country is NOT treated as UAE. Most profiles are
--                  unconfirmed, and blocking everyone who has not yet picked
--                  a country would break health tracking for users nowhere
--                  near the UAE. Absence of evidence is not evidence of AE.
--
--   REGION axis -> cf-ipcountry on this request. FAILS CLOSED: a positive
--                  'AE' signal blocks the write outright, regardless of home
--                  country, because the data would be generated in the UAE.
--                  No signal at all is not a positive signal, so it defers to
--                  the Home axis rather than failing the write.
--
-- This asymmetry is deliberate and differs from minor_age_for_country(), which
-- fails CLOSED on unknown. Age is about WHO the user is and we can never
-- verify it, so we take the strict reading. Health locality is about WHERE the
-- user is, and we now have a positive signal for it -- so we act on the signal
-- when it is present rather than on the absence of one.
CREATE OR REPLACE FUNCTION public.health_data_allowed(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.health_request_region_ok()
     AND COALESCE(
           (SELECT upper(trim(coalesce(p.country_code,''))) <> 'AE'
            FROM public.profiles p WHERE p.id = _user_id),
           true);
$$;

-- TEMPORARY proof harness. Admin-only. Creates a throwaway profile, attempts a
-- write against each health table under the requested conditions, captures the
-- real error, and always removes the throwaway row. Dropped in the next
-- migration.
CREATE OR REPLACE FUNCTION public.__ae_health_proof(_country text, _fake_region text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := gen_random_uuid();
  out jsonb := '{}'::jsonb;
  err text;
BEGIN
  IF NOT public.is_admin(auth.uid()) AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  IF _fake_region IS NOT NULL THEN
    PERFORM set_config('request.headers',
      json_build_object('cf-ipcountry', _fake_region)::text, true);
  ELSE
    PERFORM set_config('request.headers', '{}', true);
  END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email,
                          encrypted_password, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'ae-proof-' || uid || '@example.invalid',
          '', now(), now());
  UPDATE public.profiles SET country_code = _country WHERE id = uid;

  out := out || jsonb_build_object('country_code',
    (SELECT country_code FROM public.profiles WHERE id = uid),
    'health_data_allowed', public.health_data_allowed(uid),
    'region_ok', public.health_request_region_ok());

  BEGIN
    INSERT INTO public.health_checkins (user_id, day, mood) VALUES (uid, current_date, 3);
    out := out || jsonb_build_object('health_checkins', 'INSERTED');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
    out := out || jsonb_build_object('health_checkins', SQLSTATE || ': ' || err);
  END;

  BEGIN
    INSERT INTO public.cycle_logs (user_id, period_start) VALUES (uid, current_date);
    out := out || jsonb_build_object('cycle_logs', 'INSERTED');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
    out := out || jsonb_build_object('cycle_logs', SQLSTATE || ': ' || err);
  END;

  BEGIN
    INSERT INTO public.health_profiles (user_id, experience) VALUES (uid, 'women');
    out := out || jsonb_build_object('health_profiles', 'INSERTED');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
    out := out || jsonb_build_object('health_profiles', SQLSTATE || ': ' || err);
  END;

  DELETE FROM public.health_checkins WHERE user_id = uid;
  DELETE FROM public.cycle_logs WHERE user_id = uid;
  DELETE FROM public.health_profiles WHERE user_id = uid;
  DELETE FROM auth.users WHERE id = uid;
  PERFORM set_config('request.headers', '{}', true);

  out := out || jsonb_build_object('leftover_profiles',
    (SELECT count(*) FROM public.profiles WHERE id = uid));
  RETURN out;
END;
$$;

REVOKE ALL ON FUNCTION public.__ae_health_proof(text, text) FROM PUBLIC, anon, authenticated;