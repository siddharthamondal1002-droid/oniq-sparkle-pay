-- Breach-notification pipeline (DPDP Rule 7 + CERT-In 6h). One awareness
-- timestamp drives all three clocks. Summaries must never contain PII —
-- ids/counts/rule names only (enforced by review, documented in
-- docs/incident-response.md).
CREATE TABLE IF NOT EXISTS public.security_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  aware_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warn','critical')),
  summary text NOT NULL,
  affected_count int,
  -- Trigger-maintained (timestamptz + interval is not immutable).
  cert_in_deadline timestamptz,
  dpb_report_deadline timestamptz,
  user_notified_at timestamptz,
  cert_in_reported_at timestamptz,
  dpb_intimated_at timestamptz,
  dpb_reported_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','contained','reported','closed')),
  notes text
);

ALTER TABLE public.security_incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS incidents_admin_all ON public.security_incidents;
CREATE POLICY incidents_admin_all ON public.security_incidents
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
GRANT SELECT, INSERT, UPDATE ON public.security_incidents TO authenticated;
GRANT ALL ON public.security_incidents TO service_role;

CREATE OR REPLACE FUNCTION public.incident_set_deadlines() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.cert_in_deadline := NEW.aware_at + interval '6 hours';
  NEW.dpb_report_deadline := NEW.aware_at + interval '72 hours';
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS incident_deadlines ON public.security_incidents;
CREATE TRIGGER incident_deadlines BEFORE INSERT OR UPDATE OF aware_at
  ON public.security_incidents FOR EACH ROW EXECUTE FUNCTION public.incident_set_deadlines();
