-- ============================================================
-- DPDP consent ledger + append-only audit log (ADDITIVE ONLY)
-- ============================================================

-- ---------- AUDIT LOG (global hash chain) ----------
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigserial NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  prev_hash text,
  record_hash text NOT NULL DEFAULT ''
);

GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_read_own ON public.audit_log
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));
-- No INSERT/UPDATE/DELETE policy: rows arrive only via SECURITY DEFINER fns.

CREATE OR REPLACE FUNCTION public.audit_log_chain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE p text;
BEGIN
  PERFORM pg_advisory_xact_lock(7700000000000010);
  SELECT record_hash INTO p FROM public.audit_log ORDER BY seq DESC LIMIT 1;
  NEW.prev_hash := p;
  NEW.record_hash := encode(extensions.digest(
    NEW.seq::text || '|' || NEW.id::text || '|' || COALESCE(NEW.user_id::text,'') || '|' ||
    NEW.event_type || '|' || NEW.event_data::text || '|' || NEW.actor || '|' ||
    to_char(NEW.created_at AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
    COALESCE(p,''), 'sha256'), 'hex');
  RETURN NEW;
END $$;

CREATE TRIGGER audit_log_chain_before_insert
  BEFORE INSERT ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_chain();

CREATE OR REPLACE FUNCTION public.append_audit(
  _event_type text, _event_data jsonb DEFAULT '{}'::jsonb,
  _user_id uuid DEFAULT NULL, _actor text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE new_id uuid;
BEGIN
  INSERT INTO public.audit_log (user_id, event_type, event_data, actor)
  VALUES (_user_id, _event_type, COALESCE(_event_data,'{}'::jsonb),
          COALESCE(_actor, COALESCE(auth.uid()::text,'system')))
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION public.append_audit(text, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.verify_audit_chain()
RETURNS TABLE(ok boolean, rows_checked integer, first_bad uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE r record; prev text := NULL; n integer := 0; bad uuid := NULL; calc text;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'admin only'; END IF;
  FOR r IN SELECT * FROM public.audit_log ORDER BY seq ASC LOOP
    n := n + 1;
    calc := encode(extensions.digest(
      r.seq::text || '|' || r.id::text || '|' || COALESCE(r.user_id::text,'') || '|' ||
      r.event_type || '|' || r.event_data::text || '|' || r.actor || '|' ||
      to_char(r.created_at AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
      COALESCE(prev,''), 'sha256'), 'hex');
    IF calc <> r.record_hash OR r.prev_hash IS DISTINCT FROM prev THEN
      bad := r.id; EXIT;
    END IF;
    prev := r.record_hash;
  END LOOP;
  RETURN QUERY SELECT bad IS NULL, n, bad;
END $$;

-- ---------- CONSENT LEDGER (per-user hash chain) ----------
CREATE TABLE public.consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigserial NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  schema_version text NOT NULL DEFAULT 'iso-27560-2023',
  purpose_id text NOT NULL,
  purpose_desc text NOT NULL,
  data_categories jsonb NOT NULL,
  notice_version text NOT NULL,
  notice_locale text NOT NULL,
  consent_state text NOT NULL CHECK (consent_state IN ('granted','withdrawn')),
  jurisdiction text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  prev_hash text,
  record_hash text NOT NULL DEFAULT ''
);

CREATE INDEX consent_records_user_seq_idx ON public.consent_records (user_id, seq DESC);

-- Append-only by construction: SELECT + INSERT only, never UPDATE/DELETE.
GRANT SELECT, INSERT ON public.consent_records TO authenticated;
GRANT SELECT, INSERT ON public.consent_records TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.consent_records_seq_seq TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.audit_log_seq_seq TO service_role;
REVOKE UPDATE, DELETE ON public.consent_records FROM authenticated, anon;

ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY read_own ON public.consent_records
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY insert_own ON public.consent_records
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
-- deliberately no UPDATE or DELETE policy, for anyone.

CREATE OR REPLACE FUNCTION public.consent_records_chain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE p text;
BEGIN
  -- Client-supplied hashes are always discarded.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 7701));
  SELECT record_hash INTO p FROM public.consent_records
    WHERE user_id = NEW.user_id ORDER BY seq DESC LIMIT 1;
  NEW.created_at := now();
  NEW.prev_hash := p;
  NEW.record_hash := encode(extensions.digest(
    NEW.seq::text || '|' || NEW.id::text || '|' || NEW.user_id::text || '|' ||
    NEW.schema_version || '|' || NEW.purpose_id || '|' || NEW.purpose_desc || '|' ||
    NEW.data_categories::text || '|' || NEW.notice_version || '|' || NEW.notice_locale || '|' ||
    NEW.consent_state || '|' || NEW.jurisdiction || '|' ||
    to_char(NEW.created_at AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
    COALESCE(p,''), 'sha256'), 'hex');
  RETURN NEW;
END $$;

CREATE TRIGGER consent_records_chain_before_insert
  BEFORE INSERT ON public.consent_records
  FOR EACH ROW EXECUTE FUNCTION public.consent_records_chain();

CREATE OR REPLACE FUNCTION public.consent_records_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.append_audit(
    'consent_' || NEW.consent_state,
    jsonb_build_object(
      'consent_record_id', NEW.id, 'purpose_id', NEW.purpose_id,
      'notice_version', NEW.notice_version, 'notice_locale', NEW.notice_locale,
      'jurisdiction', NEW.jurisdiction, 'record_hash', NEW.record_hash),
    NEW.user_id, NEW.user_id::text);
  RETURN NEW;
END $$;

CREATE TRIGGER consent_records_audit_after_insert
  AFTER INSERT ON public.consent_records
  FOR EACH ROW EXECUTE FUNCTION public.consent_records_audit();

CREATE OR REPLACE FUNCTION public.verify_consent_chain(_user_id uuid DEFAULT NULL)
RETURNS TABLE(ok boolean, rows_checked integer, first_bad uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE target uuid := COALESCE(_user_id, auth.uid());
        r record; prev text := NULL; n integer := 0; bad uuid := NULL; calc text;
BEGIN
  IF target IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF target <> auth.uid() AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  FOR r IN SELECT * FROM public.consent_records WHERE user_id = target ORDER BY seq ASC LOOP
    n := n + 1;
    calc := encode(extensions.digest(
      r.seq::text || '|' || r.id::text || '|' || r.user_id::text || '|' ||
      r.schema_version || '|' || r.purpose_id || '|' || r.purpose_desc || '|' ||
      r.data_categories::text || '|' || r.notice_version || '|' || r.notice_locale || '|' ||
      r.consent_state || '|' || r.jurisdiction || '|' ||
      to_char(r.created_at AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
      COALESCE(prev,''), 'sha256'), 'hex');
    IF calc <> r.record_hash OR r.prev_hash IS DISTINCT FROM prev THEN
      bad := r.id; EXIT;
    END IF;
    prev := r.record_hash;
  END LOOP;
  RETURN QUERY SELECT bad IS NULL, n, bad;
END $$;

-- ---------- BREACH NOTIFICATION PLUMBING ----------
-- RUNBOOK (DPDP Act 2023, Rule 7 — no materiality threshold; EVERY breach):
--   1. On awareness:  SELECT public.breach_record_awareness('<summary>', <affected uuid[]>);
--      -> stamps aware_at; deadlines: users + Board "without delay", full report +72h.
--   2. Without delay: SELECT public.breach_notify_users('<incident_id>', '<what/consequences/mitigation>');
--   3. Without delay: SELECT public.breach_notify_board('<incident_id>', '<reference>');
--   4. Within 72h:    SELECT public.breach_submit_report('<incident_id>', '<detailed report>');
--   Every step appends to public.audit_log (hash-chained). Admin-only. No UI.
CREATE OR REPLACE FUNCTION public.breach_record_awareness(_summary text, _affected uuid[] DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE incident_id uuid := gen_random_uuid();
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'admin only'; END IF;
  PERFORM public.append_audit('breach_awareness', jsonb_build_object(
    'incident_id', incident_id, 'summary', _summary,
    'affected_count', COALESCE(array_length(_affected,1),0),
    'affected_user_ids', COALESCE(to_jsonb(_affected), '[]'::jsonb),
    'aware_at', now(),
    'board_report_due', now() + interval '72 hours'), NULL, auth.uid()::text);
  RETURN incident_id;
END $$;

CREATE OR REPLACE FUNCTION public.breach_notify_users(_incident_id uuid, _message text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'admin only'; END IF;
  PERFORM public.append_audit('breach_users_notified', jsonb_build_object(
    'incident_id', _incident_id, 'message', _message, 'at', now()), NULL, auth.uid()::text);
END $$;

CREATE OR REPLACE FUNCTION public.breach_notify_board(_incident_id uuid, _reference text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'admin only'; END IF;
  PERFORM public.append_audit('breach_board_notified', jsonb_build_object(
    'incident_id', _incident_id, 'reference', _reference, 'at', now()), NULL, auth.uid()::text);
END $$;

CREATE OR REPLACE FUNCTION public.breach_submit_report(_incident_id uuid, _report text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'admin only'; END IF;
  PERFORM public.append_audit('breach_report_submitted', jsonb_build_object(
    'incident_id', _incident_id, 'report', _report, 'at', now()), NULL, auth.uid()::text);
END $$;

REVOKE ALL ON FUNCTION public.breach_record_awareness(text, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.breach_notify_users(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.breach_notify_board(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.breach_submit_report(uuid, text) FROM PUBLIC, anon;