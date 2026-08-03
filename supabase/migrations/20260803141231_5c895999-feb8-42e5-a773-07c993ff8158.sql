-- ============================================================
-- Phase 3 — Data Subject Requests (DPDP ss.11-13). Additive only.
-- ============================================================

-- === 1. dsr_requests ticket table ===========================================
-- Reversible: DROP TABLE public.dsr_requests;
CREATE TABLE IF NOT EXISTS public.dsr_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_type  text NOT NULL CHECK (request_type IN ('access','correction','erasure','portability')),
  status        text NOT NULL DEFAULT 'received'
                CHECK (status IN ('received','processing','completed','soft_deleted','purged','cancelled','rejected')),
  details       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Derived columns. timestamptz + interval is only STABLE, so Postgres
  -- refuses it in a GENERATED expression — the trigger below fills these
  -- and clients cannot write them (no client write grant at all).
  sla_deadline  timestamptz,
  erasure_effective_at timestamptz,
  soft_deleted_at  timestamptz,
  grace_expires_at timestamptz,
  purged_at        timestamptz,
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Reversible: DROP FUNCTION public.dsr_fill_derived() CASCADE;
CREATE OR REPLACE FUNCTION public.dsr_fill_derived()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  -- ONE 30-day SLA for all four request types. Do not vary it.
  NEW.sla_deadline := NEW.created_at + interval '30 days';
  -- 48-hour advance notice before an erasure takes effect.
  NEW.erasure_effective_at := CASE
    WHEN NEW.request_type = 'erasure' THEN NEW.created_at + interval '48 hours'
    ELSE NULL END;
  NEW.grace_expires_at := CASE
    WHEN NEW.soft_deleted_at IS NOT NULL THEN NEW.soft_deleted_at + interval '30 days'
    ELSE NULL END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS dsr_requests_fill_derived ON public.dsr_requests;
CREATE TRIGGER dsr_requests_fill_derived
  BEFORE INSERT OR UPDATE ON public.dsr_requests
  FOR EACH ROW EXECUTE FUNCTION public.dsr_fill_derived();

CREATE INDEX IF NOT EXISTS dsr_requests_user_idx ON public.dsr_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dsr_requests_due_idx ON public.dsr_requests (status, request_type);

-- Read-only for the data subject; every write is service-role only
-- (append-only-ticket pattern, as for legal_holds / takedown_orders).
GRANT SELECT ON public.dsr_requests TO authenticated;
GRANT ALL ON public.dsr_requests TO service_role;

ALTER TABLE public.dsr_requests ENABLE ROW LEVEL SECURITY;

-- Reversible: DROP POLICY dsr_requests_select_own ON public.dsr_requests;
DROP POLICY IF EXISTS dsr_requests_select_own ON public.dsr_requests;
CREATE POLICY dsr_requests_select_own ON public.dsr_requests
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Reversible: DROP TRIGGER dsr_requests_touch_updated_at ON public.dsr_requests;
DROP TRIGGER IF EXISTS dsr_requests_touch_updated_at ON public.dsr_requests;
CREATE TRIGGER dsr_requests_touch_updated_at
  BEFORE UPDATE ON public.dsr_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- === 2. Promote due erasures to soft-delete =================================
-- Reversible: DROP FUNCTION public.dsr_promote_due_erasures();
-- DEFERRAL (logged, not silently missing): self-serve un-banning is NOT built
-- this pass. Recovering an account during the 30-day grace window requires
-- emailing grievance@oniqhub.com; an admin clears banned_until manually.
CREATE OR REPLACE FUNCTION public.dsr_promote_due_erasures()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT id, user_id FROM public.dsr_requests
    WHERE request_type = 'erasure' AND status = 'received'
      AND erasure_effective_at IS NOT NULL AND erasure_effective_at <= now()
  LOOP
    -- Force logout everywhere.
    DELETE FROM auth.refresh_tokens WHERE user_id = r.user_id::text;
    DELETE FROM auth.sessions WHERE user_id = r.user_id;
    -- THIS is the soft delete: sign-in blocked immediately, data still exists
    -- for the 30-day grace window.
    UPDATE auth.users SET banned_until = timestamptz '2999-01-01 00:00:00+00'
      WHERE id = r.user_id;
    UPDATE public.dsr_requests
      SET status = 'soft_deleted', soft_deleted_at = now(), updated_at = now()
      WHERE id = r.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- === 3. Hard purge after the 30-day grace window ============================
-- Reversible: DROP FUNCTION public.dsr_hard_purge_due();
-- Order matters: the audit proof is written FIRST (audit_log.user_id is
-- ON DELETE SET NULL, so the record survives the user's deletion), then the
-- ticket is marked, then the purge is fired at the edge function.
CREATE OR REPLACE FUNCTION public.dsr_hard_purge_due()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; n integer := 0; k text;
BEGIN
  -- Same vault secret the process-email-queue cron uses; no secret is
  -- embedded in this migration.
  SELECT decrypted_secret INTO k FROM vault.decrypted_secrets
    WHERE name = 'email_queue_service_role_key' LIMIT 1;

  FOR r IN
    SELECT id, user_id, created_at FROM public.dsr_requests
    WHERE status = 'soft_deleted' AND purged_at IS NULL
      AND grace_expires_at IS NOT NULL AND grace_expires_at <= now()
  LOOP
    PERFORM public.append_audit(
      'dsr_erasure_purged',
      jsonb_build_object('request_id', r.id, 'requested_at', r.created_at,
                         'purged_at', now(), 'sla_days', 30),
      r.user_id, 'system');

    UPDATE public.dsr_requests
      SET purged_at = now(), status = 'purged', updated_at = now()
      WHERE id = r.id;

    IF k IS NOT NULL THEN
      PERFORM net.http_post(
        url := 'https://bqwttemnnoexadpwifcj.supabase.co/functions/v1/dsr-handler',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-internal-secret', k),
        body := jsonb_build_object('action', 'internal_purge', 'user_id', r.user_id)
      );
    END IF;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.dsr_promote_due_erasures() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.dsr_hard_purge_due() FROM public, anon, authenticated;

-- ============================================================
-- POST-MIGRATION STEPS (applied live, not committed — same convention as
-- supabase/migrations/20260711063547_email_infra.sql)
--   SELECT cron.schedule('dsr-promote-erasures', '*/15 * * * *',
--     $$ SELECT public.dsr_promote_due_erasures(); $$);
--   SELECT cron.schedule('dsr-hard-purge', '*/15 * * * *',
--     $$ SELECT public.dsr_hard_purge_due(); $$);
--   To revert: SELECT cron.unschedule('dsr-promote-erasures');
--              SELECT cron.unschedule('dsr-hard-purge');
-- ============================================================