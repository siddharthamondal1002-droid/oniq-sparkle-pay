-- ============================================================
-- AGE GATE + VERIFIABLE PARENTAL CONSENT (additive, reversible)
-- ============================================================

-- 1. REQUEST TABLE ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.parental_consent_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_email     text,
  method           text NOT NULL CHECK (method IN ('adult_account','digilocker')),
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','verified','failed','expired')),
  code             text NOT NULL,
  verifier_user_id uuid REFERENCES auth.users(id),
  -- DigiLocker: opaque token REFERENCE only. Never an Aadhaar number, never a
  -- raw government ID, never a document. The check below refuses a 12-digit
  -- string outright so an Aadhaar cannot be pasted in even by mistake.
  token_ref        text CHECK (token_ref IS NULL OR (length(token_ref) BETWEEN 8 AND 128
                               AND token_ref !~ '^[0-9]{12}$')),
  failure_reason   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT now() + interval '7 days',
  verified_at      timestamptz
);

CREATE INDEX IF NOT EXISTS parental_consent_requests_child_idx
  ON public.parental_consent_requests (child_user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS parental_consent_requests_code_idx
  ON public.parental_consent_requests (code) WHERE status = 'pending';

GRANT SELECT ON public.parental_consent_requests TO authenticated;
GRANT ALL    ON public.parental_consent_requests TO service_role;

ALTER TABLE public.parental_consent_requests ENABLE ROW LEVEL SECURITY;

-- Child sees only their own requests. No INSERT/UPDATE/DELETE policy at all:
-- every mutation goes through the SECURITY DEFINER functions below.
CREATE POLICY "child reads own parental consent requests"
  ON public.parental_consent_requests FOR SELECT TO authenticated
  USING (child_user_id = auth.uid());

COMMENT ON TABLE public.parental_consent_requests IS
  'Verifiable parental consent for under-threshold accounts. token_ref holds an opaque DigiLocker reference only; storing an Aadhaar number or document is refused by CHECK.';

-- 2. AGE THRESHOLD AT SIGNUP: stop hardcoding 18 ------------------------
CREATE OR REPLACE FUNCTION public.set_signup_profile(
  _dob date, _parent_name text DEFAULT NULL, _parent_email text DEFAULT NULL,
  _parent_phone text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  me uuid := auth.uid();
  minor boolean;
  threshold int;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _dob IS NULL OR _dob > current_date OR _dob < '1900-01-01' THEN
    RAISE EXCEPTION 'invalid date of birth';
  END IF;

  -- Threshold comes from the account's home country via the existing
  -- fail-closed function (18 unless the country is explicitly a 13 regime).
  SELECT public.minor_age_for_country(p.country_code) INTO threshold
    FROM public.profiles p WHERE p.id = me;
  threshold := coalesce(threshold, public.minor_age_for_country(NULL));

  minor := date_part('year', age(current_date, _dob)) < threshold;

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
  RETURN jsonb_build_object('is_minor', minor, 'threshold', threshold);
END; $function$;

-- 3. VERIFICATION + RESTRICTED STATE PREDICATES -------------------------
CREATE OR REPLACE FUNCTION public.parental_consent_verified(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.parental_consent_requests r
    WHERE r.child_user_id = _uid AND r.status = 'verified');
$function$;

-- Restricted = under threshold AND parental consent not yet verified.
-- Recoverable by construction: it is a live predicate, not a stored flag, so
-- verifying later lifts it immediately with no data loss.
CREATE OR REPLACE FUNCTION public.child_restricted(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT _uid IS NOT NULL
     AND public.is_minor_account(_uid)
     AND NOT public.parental_consent_verified(_uid);
$function$;

REVOKE EXECUTE ON FUNCTION public.parental_consent_verified(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.child_restricted(uuid)          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.parental_consent_verified(uuid) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.child_restricted(uuid)          TO authenticated, service_role;

-- 4. STATUS FOR THE SIGNED-IN ACCOUNT -----------------------------------
CREATE OR REPLACE FUNCTION public.my_age_gate_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE me uuid := auth.uid(); r record;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT pp.date_of_birth IS NOT NULL AS has_dob,
         public.minor_age_for_country(p.country_code) AS threshold
    INTO r
    FROM public.profiles p LEFT JOIN public.profiles_private pp ON pp.user_id = p.id
   WHERE p.id = me;
  RETURN jsonb_build_object(
    'has_dob',    coalesce(r.has_dob, false),
    'threshold',  coalesce(r.threshold, public.minor_age_for_country(NULL)),
    'is_minor',   public.is_minor_account(me),
    'verified',   public.parental_consent_verified(me),
    'restricted', public.child_restricted(me),
    'pending', (
      SELECT jsonb_build_object('id', q.id, 'method', q.method, 'parent_email', q.parent_email,
                                'code', q.code, 'expires_at', q.expires_at, 'status', q.status,
                                'failure_reason', q.failure_reason)
        FROM public.parental_consent_requests q
       WHERE q.child_user_id = me AND q.status = 'pending' AND q.expires_at > now()
       ORDER BY q.created_at DESC LIMIT 1)
  );
END; $function$;

REVOKE EXECUTE ON FUNCTION public.my_age_gate_status() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_age_gate_status() TO authenticated, service_role;

-- 5. LEDGER WRITE HELPER (parental consent is evidence, so it goes in the
--    hash-chained ledger; the chain triggers compute the hashes) ---------
CREATE OR REPLACE FUNCTION public.log_parental_consent(
  _child uuid, _method text, _detail jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE cc text;
BEGIN
  SELECT upper(coalesce(p.country_code,'')) INTO cc FROM public.profiles p WHERE p.id = _child;
  INSERT INTO public.consent_records (
    user_id, schema_version, purpose_id, purpose_desc, data_categories,
    notice_version, notice_locale, consent_state, jurisdiction)
  VALUES (
    _child, '1', 'parental_consent',
    'Verifiable consent given by a parent or lawful guardian so this under-age account may be processed beyond age verification.',
    jsonb_build_array(
      jsonb_build_object('id','parent_identity','label','Parent or guardian identity signal'),
      jsonb_build_object('id','verification_method','label','How the consent was verified')
    ) || coalesce(_detail, '[]'::jsonb),
    'parental-consent-v1', 'en', 'granted',
    CASE WHEN cc IN ('US','GB','AE','CA','AU','SG') THEN cc ELSE 'IN' END);
END; $function$;

REVOKE EXECUTE ON FUNCTION public.log_parental_consent(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.log_parental_consent(uuid, text, jsonb) TO service_role;

-- 6. CHILD ASKS FOR CONSENT ---------------------------------------------
CREATE OR REPLACE FUNCTION public.request_parental_consent(
  _parent_email text, _method text DEFAULT 'adult_account')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE me uuid := auth.uid(); new_code text; row_id uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_minor_account(me) THEN
    RAISE EXCEPTION 'parental consent is only for accounts under the age of digital consent';
  END IF;
  IF _method NOT IN ('adult_account','digilocker') THEN
    RAISE EXCEPTION 'unknown verification method';
  END IF;
  IF _method = 'adult_account'
     AND coalesce(_parent_email,'') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'a valid parent email is required';
  END IF;

  UPDATE public.parental_consent_requests
     SET status = 'expired'
   WHERE child_user_id = me AND status = 'pending';

  new_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
  INSERT INTO public.parental_consent_requests (child_user_id, parent_email, method, code)
  VALUES (me, lower(nullif(trim(_parent_email),'')), _method, new_code)
  RETURNING id INTO row_id;

  RETURN jsonb_build_object('id', row_id, 'code', new_code, 'method', _method);
END; $function$;

REVOKE EXECUTE ON FUNCTION public.request_parental_consent(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.request_parental_consent(text, text) TO authenticated;

-- 7. PATH (a): an existing VERIFIED ADULT ONIQ ACCOUNT approves ----------
CREATE OR REPLACE FUNCTION public.approve_parental_consent(_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE me uuid := auth.uid(); req record; adult_dob date;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- The approver must be a confirmed adult: DOB on file AND above their own
  -- country's threshold. An account with no DOB fails closed and cannot approve.
  SELECT pp.date_of_birth INTO adult_dob
    FROM public.profiles_private pp WHERE pp.user_id = me;
  IF adult_dob IS NULL THEN
    RAISE EXCEPTION 'only an age-verified adult account can approve parental consent';
  END IF;
  IF date_part('year', age(current_date, adult_dob))
       < (SELECT public.minor_age_for_country(p.country_code) FROM public.profiles p WHERE p.id = me) THEN
    RAISE EXCEPTION 'only an adult account can approve parental consent';
  END IF;

  SELECT * INTO req FROM public.parental_consent_requests
   WHERE code = upper(trim(_code)) AND status = 'pending' FOR UPDATE;
  IF req.id IS NULL THEN RAISE EXCEPTION 'no pending request for that code'; END IF;
  IF req.expires_at <= now() THEN
    UPDATE public.parental_consent_requests SET status='expired' WHERE id = req.id;
    RAISE EXCEPTION 'that code has expired';
  END IF;
  IF req.child_user_id = me THEN
    RAISE EXCEPTION 'an account cannot approve its own parental consent';
  END IF;

  UPDATE public.parental_consent_requests
     SET status='verified', verifier_user_id = me, verified_at = now()
   WHERE id = req.id;

  PERFORM public.log_parental_consent(req.child_user_id, 'adult_account',
    jsonb_build_array(jsonb_build_object('id','verifier_account','label','Verified adult ONIQ account')));

  RETURN jsonb_build_object('ok', true, 'child_user_id', req.child_user_id);
END; $function$;

REVOKE EXECUTE ON FUNCTION public.approve_parental_consent(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.approve_parental_consent(text) TO authenticated;

-- 8. PATH (b): DigiLocker age token — REFERENCE ONLY --------------------
CREATE OR REPLACE FUNCTION public.submit_digilocker_parental_consent(_token_ref text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE me uuid := auth.uid(); req record; t text := nullif(trim(_token_ref),'');
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF t IS NULL OR length(t) < 8 OR length(t) > 128 THEN
    RAISE EXCEPTION 'invalid token reference';
  END IF;
  -- Refuse anything that could be a raw government identifier.
  IF t ~ '^[0-9]{12}$' OR t ~ '^[0-9\s-]{12,}$' THEN
    RAISE EXCEPTION 'only an opaque token reference may be stored, never an ID number';
  END IF;

  SELECT * INTO req FROM public.parental_consent_requests
   WHERE child_user_id = me AND method = 'digilocker' AND status = 'pending'
   ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF req.id IS NULL THEN RAISE EXCEPTION 'no pending DigiLocker request'; END IF;
  IF req.expires_at <= now() THEN
    UPDATE public.parental_consent_requests SET status='expired' WHERE id = req.id;
    RAISE EXCEPTION 'that request has expired';
  END IF;

  UPDATE public.parental_consent_requests
     SET status='verified', token_ref = t, verified_at = now()
   WHERE id = req.id;

  PERFORM public.log_parental_consent(me, 'digilocker',
    jsonb_build_array(jsonb_build_object('id','digilocker_token_ref','label','DigiLocker age-token reference (no ID number, no document)')));

  RETURN jsonb_build_object('ok', true);
END; $function$;

REVOKE EXECUTE ON FUNCTION public.submit_digilocker_parental_consent(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.submit_digilocker_parental_consent(text) TO authenticated;

-- 9. RESTRICTED STATE, ENFORCED WHERE DATA IS WRITTEN --------------------
-- Loud refusal, never a silent no-op: the caller gets an error it can show.
CREATE OR REPLACE FUNCTION public.restricted_child_write_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF public.child_restricted(auth.uid()) THEN
    RAISE EXCEPTION 'restricted: this account is under the age of digital consent and parental consent has not been verified yet. Nothing was saved.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_restricted_child_moments   ON public.moments_posts;
CREATE TRIGGER trg_restricted_child_moments   BEFORE INSERT ON public.moments_posts
  FOR EACH ROW EXECUTE FUNCTION public.restricted_child_write_guard();
DROP TRIGGER IF EXISTS trg_restricted_child_clips     ON public.clips;
CREATE TRIGGER trg_restricted_child_clips     BEFORE INSERT ON public.clips
  FOR EACH ROW EXECUTE FUNCTION public.restricted_child_write_guard();
DROP TRIGGER IF EXISTS trg_restricted_child_status    ON public.status_updates;
CREATE TRIGGER trg_restricted_child_status    BEFORE INSERT ON public.status_updates
  FOR EACH ROW EXECUTE FUNCTION public.restricted_child_write_guard();
DROP TRIGGER IF EXISTS trg_restricted_child_ai_chats  ON public.ai_chats;
CREATE TRIGGER trg_restricted_child_ai_chats  BEFORE INSERT ON public.ai_chats
  FOR EACH ROW EXECUTE FUNCTION public.restricted_child_write_guard();
DROP TRIGGER IF EXISTS trg_restricted_child_study_msg ON public.study_messages;
CREATE TRIGGER trg_restricted_child_study_msg BEFORE INSERT ON public.study_messages
  FOR EACH ROW EXECUTE FUNCTION public.restricted_child_write_guard();
DROP TRIGGER IF EXISTS trg_restricted_child_quiz      ON public.quiz_attempts;
CREATE TRIGGER trg_restricted_child_quiz      BEFORE INSERT ON public.quiz_attempts
  FOR EACH ROW EXECUTE FUNCTION public.restricted_child_write_guard();

COMMENT ON FUNCTION public.restricted_child_write_guard() IS
  'Restricted state for unverified under-age accounts. Raises 42501 so the UI can tell the user nothing was saved; lifted automatically once parental consent is verified.';
