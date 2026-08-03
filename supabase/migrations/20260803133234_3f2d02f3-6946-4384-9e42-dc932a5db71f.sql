-- === 1. Mark the legacy table (reversible: COMMENT ON TABLE ... IS NULL) ===
COMMENT ON TABLE public.user_consents IS
  'LEGACY. public.consent_records is the source of truth for consent. This table is written only as a mirror by record_consent() while readers remain (personalisation_allowed, export_my_data, src/lib/personalisation.ts). Do not add new readers.';

-- === 2. A minor may never self-consent — enforced at the ledger ===
-- Reversible: DROP TRIGGER consent_records_minor_guard_before_insert ON public.consent_records;
--             DROP FUNCTION public.consent_records_minor_guard();
CREATE OR REPLACE FUNCTION public.consent_records_minor_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.consent_state = 'granted'
     AND NEW.purpose_id <> 'parental_consent'
     AND public.is_minor_account(NEW.user_id) THEN
    RAISE EXCEPTION 'restricted: this account is under the age of digital consent and cannot give its own consent. A verified parent must consent first. Nothing was saved.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS consent_records_minor_guard_before_insert ON public.consent_records;
CREATE TRIGGER consent_records_minor_guard_before_insert
  BEFORE INSERT ON public.consent_records
  FOR EACH ROW EXECUTE FUNCTION public.consent_records_minor_guard();

-- === 3. Same refusal on the legacy table, so a crafted request cannot use it ===
-- Reversible: DROP TRIGGER user_consents_minor_guard_before_insert ON public.user_consents;
--             DROP FUNCTION public.user_consents_minor_guard();
CREATE OR REPLACE FUNCTION public.user_consents_minor_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(NEW.granted, false) AND public.is_minor_account(NEW.user_id) THEN
    RAISE EXCEPTION 'restricted: this account is under the age of digital consent and cannot give its own consent. A verified parent must consent first. Nothing was saved.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS user_consents_minor_guard_before_insert ON public.user_consents;
CREATE TRIGGER user_consents_minor_guard_before_insert
  BEFORE INSERT ON public.user_consents
  FOR EACH ROW EXECUTE FUNCTION public.user_consents_minor_guard();

-- === 4. record_consent writes the LEDGER first, legacy table only as a mirror ===
-- Reversible: DROP the 7-arg form and restore the previous 3-arg body:
--   CREATE OR REPLACE FUNCTION public.record_consent(_purpose text,_granted boolean,_source text DEFAULT 'signup')
--   RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ ... old body ... $$;
DROP FUNCTION IF EXISTS public.record_consent(text, boolean, text);

CREATE OR REPLACE FUNCTION public.record_consent(
  _purpose         text,
  _granted         boolean,
  _source          text    DEFAULT 'app',
  _notice_version  text    DEFAULT 'unversioned',
  _notice_locale   text    DEFAULT 'en',
  _purpose_desc    text    DEFAULT NULL,
  _categories      jsonb   DEFAULT '[]'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  me uuid := auth.uid();
  cc text;
  pdesc text;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _purpose NOT IN ('location','health','ai','general','personalisation') THEN
    RAISE EXCEPTION 'invalid purpose';
  END IF;

  -- A child cannot consent for itself, for any purpose, granting or not.
  -- Withdrawal by the account itself stays permitted (never less protective).
  IF coalesce(_granted, false) AND public.is_minor_account(me) THEN
    RAISE EXCEPTION 'restricted: this account is under the age of digital consent and cannot give its own consent. A verified parent must consent first. Nothing was saved.'
      USING ERRCODE = '42501';
  END IF;

  pdesc := coalesce(nullif(trim(_purpose_desc), ''), CASE _purpose
    WHEN 'general'         THEN 'To run your ONIQ account and the features you use.'
    WHEN 'ai'              THEN 'To answer your questions with AI assistants inside ONIQ.'
    WHEN 'location'        THEN 'To show you nearby and region-appropriate content and services.'
    WHEN 'health'          THEN 'To keep the wellbeing entries you record in Vitals.'
    WHEN 'personalisation' THEN 'To learn which parts of ONIQ you use so the right shortcut appears first.'
  END);

  SELECT upper(coalesce(p.country_code, '')) INTO cc FROM public.profiles p WHERE p.id = me;

  INSERT INTO public.consent_records (
    user_id, schema_version, purpose_id, purpose_desc, data_categories,
    notice_version, notice_locale, consent_state, jurisdiction)
  VALUES (
    me, '1', _purpose, pdesc, coalesce(_categories, '[]'::jsonb),
    coalesce(nullif(trim(_notice_version), ''), 'unversioned'),
    CASE WHEN _notice_locale IN ('en','hi') THEN _notice_locale ELSE 'en' END,
    CASE WHEN coalesce(_granted, false) THEN 'granted' ELSE 'withdrawn' END,
    CASE WHEN cc IN ('US','GB','AE','CA','AU','SG') THEN cc ELSE 'IN' END);

  -- Legacy mirror, kept only while readers remain.
  INSERT INTO public.user_consents (user_id, purpose, granted, source)
  VALUES (me, _purpose, coalesce(_granted, false), coalesce(NULLIF(trim(_source),''), 'app'));
END $$;

REVOKE EXECUTE ON FUNCTION public.record_consent(text,boolean,text,text,text,text,jsonb) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.record_consent(text,boolean,text,text,text,text,jsonb) TO authenticated;