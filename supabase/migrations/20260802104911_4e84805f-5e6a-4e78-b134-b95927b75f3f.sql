-- Loop 1: personalisation foundations (additive only)

CREATE OR REPLACE FUNCTION public.minor_age_for_country(_country text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$ SELECT CASE WHEN upper(coalesce(_country,'IN')) = 'IN' THEN 18 ELSE 13 END $$;

REVOKE EXECUTE ON FUNCTION public.minor_age_for_country(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minor_age_for_country(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_minor_account(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT CASE
       WHEN pp.date_of_birth IS NOT NULL THEN
         (date_part('year', age(current_date, pp.date_of_birth))
            < public.minor_age_for_country(p.country_code))
       ELSE pp.is_minor
     END
     FROM public.profiles_private pp
     JOIN public.profiles p ON p.id = pp.user_id
     WHERE pp.user_id = _uid),
    true);
$$;

REVOKE EXECUTE ON FUNCTION public.is_minor_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_minor_account(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.personalisation_allowed(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _uid IS NOT NULL
     AND NOT public.is_minor_account(_uid)
     AND COALESCE((
       SELECT uc.granted FROM public.user_consents uc
       WHERE uc.user_id = _uid AND uc.purpose = 'personalisation'
       ORDER BY uc.recorded_at DESC LIMIT 1), false);
$$;

REVOKE EXECUTE ON FUNCTION public.personalisation_allowed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.personalisation_allowed(uuid) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.usage_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('hub_open','card_tap','card_dismiss')),
  hub text NOT NULL CHECK (char_length(hub) <= 40),
  city text CHECK (city IS NULL OR char_length(city) <= 60),
  dow smallint NOT NULL CHECK (dow BETWEEN 0 AND 6),
  hour smallint NOT NULL CHECK (hour BETWEEN 0 AND 23),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_signals_user_time_idx
  ON public.usage_signals (user_id, created_at DESC);

GRANT SELECT, INSERT, DELETE ON public.usage_signals TO authenticated;
GRANT ALL ON public.usage_signals TO service_role;

ALTER TABLE public.usage_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY usage_signals_select_own ON public.usage_signals
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY usage_signals_delete_own ON public.usage_signals
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY usage_signals_insert_eligible ON public.usage_signals
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.personalisation_allowed(auth.uid()));

CREATE OR REPLACE FUNCTION public.usage_signals_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_minor_account(NEW.user_id) THEN
    RAISE EXCEPTION 'personalisation disabled for minor accounts';
  END IF;
  IF NOT public.personalisation_allowed(NEW.user_id) THEN
    RAISE EXCEPTION 'personalisation consent not granted';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.usage_signals_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS usage_signals_guard_trg ON public.usage_signals;
CREATE TRIGGER usage_signals_guard_trg
  BEFORE INSERT ON public.usage_signals
  FOR EACH ROW EXECUTE FUNCTION public.usage_signals_guard();

CREATE OR REPLACE FUNCTION public.personalisation_withdrawal_wipe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.purpose = 'personalisation' AND NEW.granted = false THEN
    DELETE FROM public.usage_signals WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.personalisation_withdrawal_wipe() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS personalisation_withdrawal_wipe_trg ON public.user_consents;
CREATE TRIGGER personalisation_withdrawal_wipe_trg
  AFTER INSERT ON public.user_consents
  FOR EACH ROW EXECUTE FUNCTION public.personalisation_withdrawal_wipe();

CREATE OR REPLACE FUNCTION public.record_consent(_purpose text, _granted boolean, _source text DEFAULT 'signup'::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _purpose NOT IN ('location','health','ai','general','personalisation') THEN
    RAISE EXCEPTION 'invalid purpose';
  END IF;
  IF _purpose = 'personalisation' AND coalesce(_granted,false) AND public.is_minor_account(me) THEN
    RAISE EXCEPTION 'personalisation unavailable for minor accounts';
  END IF;
  INSERT INTO public.user_consents (user_id, purpose, granted, source)
  VALUES (me, _purpose, coalesce(_granted, false), coalesce(NULLIF(trim(_source),''), 'app'));
END;
$$;