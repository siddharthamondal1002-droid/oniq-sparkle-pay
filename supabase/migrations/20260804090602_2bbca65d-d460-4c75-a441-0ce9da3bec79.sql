-- ============================================================
-- Phase 2: DOB collection — additive, reversible.
-- 1) dob_change_events: rate-limit ledger (no PII, timestamps only)
-- 2) set_signup_profile: audited, rate-limited, child-mode-safe
-- Does NOT touch is_adult_18, minor_age_for_country, audit_log chain,
-- consent_records, or any trigger on profiles_private.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dob_change_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dob_change_events_user_time
  ON public.dob_change_events (user_id, created_at DESC);

GRANT SELECT ON public.dob_change_events TO authenticated;
GRANT ALL    ON public.dob_change_events TO service_role;

ALTER TABLE public.dob_change_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own dob change events readable" ON public.dob_change_events;
CREATE POLICY "own dob change events readable"
  ON public.dob_change_events FOR SELECT TO authenticated
  USING (user_id = auth.uid());
-- No INSERT/UPDATE/DELETE policy: rows are written only by the
-- SECURITY DEFINER function below, never by the client.

CREATE OR REPLACE FUNCTION public.set_signup_profile(
  _dob date,
  _parent_name text DEFAULT NULL::text,
  _parent_email text DEFAULT NULL::text,
  _parent_phone text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me        uuid := auth.uid();
  minor     boolean;
  threshold int;
  old_dob   date;
  old_minor boolean;
  recent    int;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _dob IS NULL OR _dob > current_date OR _dob < '1900-01-01' THEN
    RAISE EXCEPTION 'invalid date of birth';
  END IF;

  SELECT pp.date_of_birth, pp.is_minor INTO old_dob, old_minor
    FROM public.profiles_private pp WHERE pp.user_id = me;

  SELECT public.minor_age_for_country(p.country_code) INTO threshold
    FROM public.profiles p WHERE p.id = me;
  threshold := coalesce(threshold, public.minor_age_for_country(NULL));

  minor := date_part('year', age(current_date, _dob)) < threshold;

  -- No-op: same date re-submitted. Never counted, never audited.
  IF old_dob IS NOT NULL AND old_dob = _dob THEN
    RETURN jsonb_build_object('ok', true, 'is_minor', old_minor, 'threshold', threshold);
  END IF;

  IF old_dob IS NOT NULL THEN
    -- Anti-gaming 1: rate limit. Three recorded edits in seven days is the cap.
    SELECT count(*) INTO recent
      FROM public.dob_change_events e
     WHERE e.user_id = me AND e.created_at > now() - interval '7 days';
    IF recent >= 3 THEN
      PERFORM public.append_audit('dob_change_refused',
        jsonb_build_object('account_id', me, 'reason', 'rate_limited',
                           'edits_last_7_days', recent, 'attempted', _dob), me);
      RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited',
        'message', 'Your date of birth has already been changed three times this week. For safety, further changes are blocked for a few days — contact the grievance officer if this is wrong.');
    END IF;

    -- Anti-gaming 2: under -> over must not lift child mode. The database
    -- trigger prevent_is_minor_self_change is the hard guard; this branch
    -- refuses first so the attempt can be written to the audit ledger
    -- (a raised exception would roll the audit row back).
    IF coalesce(old_minor, false) AND NOT minor THEN
      PERFORM public.append_audit('dob_change_refused',
        jsonb_build_object('account_id', me, 'reason', 'child_mode_locked',
                           'old_value', old_dob, 'new_value', _dob,
                           'threshold', threshold), me);
      RETURN jsonb_build_object('ok', false, 'reason', 'child_mode_locked',
        'message', 'This account is in child mode and a new date of birth cannot lift it. The account stays restricted until a parent or guardian completes parental consent.');
    END IF;
  END IF;

  IF minor THEN
    IF coalesce(trim(_parent_name),'') = '' OR coalesce(trim(_parent_email),'') = '' THEN
      RAISE EXCEPTION 'parent name and email required for accounts under the age of digital consent';
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

  IF old_dob IS NOT NULL THEN
    INSERT INTO public.dob_change_events (user_id) VALUES (me);
  END IF;

  PERFORM public.append_audit(
    CASE WHEN old_dob IS NULL THEN 'dob_set' ELSE 'dob_changed' END,
    jsonb_build_object('account_id', me, 'old_value', old_dob, 'new_value', _dob,
                       'threshold', threshold, 'is_minor', minor), me);

  RETURN jsonb_build_object('ok', true, 'is_minor', minor, 'threshold', threshold);
END; $function$;