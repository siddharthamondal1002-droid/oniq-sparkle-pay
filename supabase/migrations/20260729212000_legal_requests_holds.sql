-- L1: lawful-request intake (BNSS s.94 summons / court / govt orders).
-- Ids, scope, and reasons only — never content. Dual-control: fulfilment
-- requires two distinct admin approvals recorded on the row; the export
-- tool (scripts/evidence-export.ts) refuses to run without both.
CREATE TABLE IF NOT EXISTS public.legal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  issuer_kind text NOT NULL CHECK (issuer_kind IN ('court','police_station_officer','government','other')),
  issuer_name text,
  order_ref text,
  -- the "necessary or desirable" scope: exact records + identifier + window
  target_identifier text NOT NULL,
  records_sought text NOT NULL,
  window_start timestamptz,
  window_end timestamptz,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','validated','flagged_overbroad','approved','fulfilled','closed','rejected')),
  flag_reason text,
  approver_1 uuid,
  approver_1_at timestamptz,
  approver_2 uuid,
  approver_2_at timestamptz,
  fulfilled_at timestamptz,
  notes text,
  CONSTRAINT distinct_approvers CHECK (approver_1 IS NULL OR approver_2 IS NULL OR approver_1 <> approver_2)
);
ALTER TABLE public.legal_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_requests_admin ON public.legal_requests;
CREATE POLICY legal_requests_admin ON public.legal_requests
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
GRANT SELECT, INSERT, UPDATE ON public.legal_requests TO authenticated;
GRANT ALL ON public.legal_requests TO service_role;

-- A request cannot move to approved without two distinct recorded approvers,
-- and cannot be fulfilled unless approved. Overbroad flags block fulfilment.
CREATE OR REPLACE FUNCTION public.legal_request_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'approved' AND (NEW.approver_1 IS NULL OR NEW.approver_2 IS NULL) THEN
    RAISE EXCEPTION 'dual-control: two distinct approvals required before approval';
  END IF;
  IF NEW.status = 'fulfilled' AND OLD.status NOT IN ('approved') THEN
    RAISE EXCEPTION 'cannot fulfil a request that is not approved';
  END IF;
  IF NEW.status IN ('approved','fulfilled') AND OLD.status = 'flagged_overbroad' THEN
    RAISE EXCEPTION 'overbroad request: route to counsel; cannot auto-fulfil';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS legal_request_guard_t ON public.legal_requests;
CREATE TRIGGER legal_request_guard_t BEFORE UPDATE ON public.legal_requests
  FOR EACH ROW EXECUTE FUNCTION public.legal_request_guard();

-- L2: legal hold — suspends erasure for a scoped set of records, grants NO
-- read access to anyone (retention-layer only). DPDP s.12 erasure yields to
-- a legal/preservation obligation for the held scope (s.17 exemption);
-- override_reason records why.
CREATE TABLE IF NOT EXISTS public.legal_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  legal_request_id uuid REFERENCES public.legal_requests(id),
  subject_user_id uuid NOT NULL,
  scope text NOT NULL DEFAULT 'account',
  override_reason text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL,
  released_at timestamptz
);
CREATE INDEX IF NOT EXISTS legal_holds_subject_idx ON public.legal_holds (subject_user_id) WHERE active;
ALTER TABLE public.legal_holds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_holds_admin ON public.legal_holds;
CREATE POLICY legal_holds_admin ON public.legal_holds
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
GRANT SELECT, INSERT, UPDATE ON public.legal_holds TO authenticated;
GRANT ALL ON public.legal_holds TO service_role;

-- Erasure paths check this (delete-account edge function + future B5 jobs).
CREATE OR REPLACE FUNCTION public.has_active_legal_hold(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.legal_holds
    WHERE subject_user_id = _user_id AND active AND expires_at > now() AND released_at IS NULL
  );
$$;
REVOKE ALL ON FUNCTION public.has_active_legal_hold(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_legal_hold(uuid) TO authenticated, service_role;
