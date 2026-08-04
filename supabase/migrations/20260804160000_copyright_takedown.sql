-- ONIQ — Free & Legal Surfaces loop, Phase 1: safe-harbour plumbing.
--
-- Additive only. Reversible teardown at the bottom of this comment block.
-- Touches NOTHING in the guardrail list: consent_records, audit_log and their
-- chain triggers, is_adult_18, minor_age_for_country are all untouched.
--
-- Reversible:
--   DROP FUNCTION IF EXISTS public.copyright_purge_expired();
--   DROP FUNCTION IF EXISTS public.repeat_infringer_strikes(uuid);
--   DROP TABLE IF EXISTS public.copyright_notices;
--   ALTER TABLE public.grievances
--     DROP COLUMN IF EXISTS acknowledged_at,
--     DROP COLUMN IF EXISTS resolved_at,
--     DROP COLUMN IF EXISTS acknowledge_due_at,
--     DROP COLUMN IF EXISTS resolve_due_at;

-- ---------------------------------------------------------------------------
-- 1) Grievance SLA. IT Rules 2021: acknowledge in 24 hours, resolve in 15 days.
--    The deadlines are stored as columns, not computed in the UI, so a breach
--    is queryable and cannot be hidden by a rendering bug.
-- ---------------------------------------------------------------------------
ALTER TABLE public.grievances
  ADD COLUMN IF NOT EXISTS acknowledged_at    timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at        timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledge_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolve_due_at     timestamptz;

COMMENT ON COLUMN public.grievances.acknowledge_due_at IS
  'IT Rules 2021 r.3(2)(i): acknowledge within 24 hours of receipt.';
COMMENT ON COLUMN public.grievances.resolve_due_at IS
  'IT Rules 2021 r.3(2)(i): dispose of the complaint within 15 days.';

-- Deadlines are set server-side on insert, never by the client, so a breach is
-- queryable and cannot be moved by whoever is filing. Not GENERATED columns:
-- `timestamptz + interval` is only STABLE (session TimeZone can affect it), and
-- Postgres requires generation expressions to be IMMUTABLE.
CREATE OR REPLACE FUNCTION public.tg_grievance_set_sla()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.created_at         := coalesce(NEW.created_at, now());
  NEW.acknowledge_due_at := NEW.created_at + interval '24 hours';
  NEW.resolve_due_at     := NEW.created_at + interval '15 days';
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_grievance_set_sla ON public.grievances;
CREATE TRIGGER trg_grievance_set_sla
  BEFORE INSERT ON public.grievances
  FOR EACH ROW EXECUTE FUNCTION public.tg_grievance_set_sla();

-- Backfill the rows that predate the clock.
UPDATE public.grievances
   SET acknowledge_due_at = created_at + interval '24 hours',
       resolve_due_at     = created_at + interval '15 days'
 WHERE acknowledge_due_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2) Copyright notices + takedown record.
--    One table covers DMCA §512 notices, IT Rules takedowns and court orders,
--    because the retention and repeat-infringer duties are the same shape.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.copyright_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who complained. Nullable: rights-holders are usually not ONIQ users.
  complainant_name  text NOT NULL,
  complainant_email text NOT NULL,
  complainant_org   text,

  -- 'dmca' (US §512), 'it_rules' (India), 'court_order', 'other'
  notice_kind text NOT NULL DEFAULT 'dmca'
    CHECK (notice_kind IN ('dmca','it_rules','court_order','other')),

  -- What was complained about. ONIQ stores POINTERS, never the content itself,
  -- so this is a URL or an internal record reference — never a copy.
  target_url        text,
  target_table      text,
  target_row_id     uuid,
  -- The uploader, when the target is user-submitted. Drives the strike count.
  respondent_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  work_described    text NOT NULL,
  -- §512(c)(3)(A)(v)-(vi): good-faith statement and accuracy/perjury statement.
  sworn_statement   boolean NOT NULL DEFAULT false,

  -- 'received' -> 'actioned' | 'rejected' | 'reinstated' (after counter-notice)
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','actioned','rejected','reinstated')),
  -- A strike only counts once the notice is substantiated and not retracted.
  counts_as_strike boolean NOT NULL DEFAULT false,

  received_at   timestamptz NOT NULL DEFAULT now(),
  actioned_at   timestamptz,
  -- Rule 3(1)(j) / §512 evidence: keep the record 180 days past the action.
  purge_after   timestamptz,

  notes text
);

CREATE INDEX IF NOT EXISTS copyright_notices_respondent
  ON public.copyright_notices (respondent_id, received_at DESC);
CREATE INDEX IF NOT EXISTS copyright_notices_purge
  ON public.copyright_notices (purge_after) WHERE purge_after IS NOT NULL;

-- Rights-holder notices are not user data and must never be readable by users.
-- No grant to anon or authenticated: service_role only, via the edge function.
REVOKE ALL ON public.copyright_notices FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.copyright_notices TO service_role;

ALTER TABLE public.copyright_notices ENABLE ROW LEVEL SECURITY;
-- RLS on with no policy = deny-all for every non-superuser role. Deliberate:
-- the only access path is service_role, which bypasses RLS.

-- Set the 180-day retention clock the moment a notice is actioned.
CREATE OR REPLACE FUNCTION public.tg_copyright_set_purge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('actioned','rejected') AND NEW.actioned_at IS NULL THEN
    NEW.actioned_at := now();
  END IF;
  IF NEW.actioned_at IS NOT NULL THEN
    NEW.purge_after := NEW.actioned_at + interval '180 days';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_copyright_set_purge ON public.copyright_notices;
CREATE TRIGGER trg_copyright_set_purge
  BEFORE INSERT OR UPDATE ON public.copyright_notices
  FOR EACH ROW EXECUTE FUNCTION public.tg_copyright_set_purge();

-- ---------------------------------------------------------------------------
-- 3) Repeat-infringer counter. §512(i) requires the policy to be REASONABLY
--    IMPLEMENTED, so the count is computed from the record, not asserted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.repeat_infringer_strikes(_uid uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM public.copyright_notices n
  WHERE n.respondent_id = _uid
    AND n.counts_as_strike
    AND n.status = 'actioned'
    AND n.received_at > now() - interval '365 days'
$$;

REVOKE EXECUTE ON FUNCTION public.repeat_infringer_strikes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repeat_infringer_strikes(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Retention purge. Runs on the same 15-minute cron as the DSR jobs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.copyright_purge_expired()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.copyright_notices
   WHERE purge_after IS NOT NULL AND purge_after < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE EXECUTE ON FUNCTION public.copyright_purge_expired() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.copyright_purge_expired() TO service_role;
