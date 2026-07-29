-- IT Rules 2026 (G.S.R. 120(E)): Synthetically Generated Information.
-- Upload declaration stored on media rows + a takedown queue with the
-- 3-hour SLA and order-authority capture. Labels render client-side from
-- is_synthetic; provenance metadata embedding is tracked as a deferral.

ALTER TABLE public.moments_posts ADD COLUMN IF NOT EXISTS is_synthetic boolean NOT NULL DEFAULT false;
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS is_synthetic boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.takedown_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  -- Rule 3(1)(d): who ordered it. Joint Secretary+ (civil) / DIG+ (police).
  source text NOT NULL CHECK (source IN ('court','government','grievance','ncii_csam','internal')),
  authority text,
  order_ref text,
  content_type text NOT NULL CHECK (content_type IN ('moment','clip','message','profile','other')),
  content_id text NOT NULL,
  reason text,
  -- 3h for court/govt orders; 2h for NCII/CSAM per the 2026 amendment.
  -- timestamptz + interval is not immutable, so a trigger (below) maintains
  -- this instead of a GENERATED column.
  sla_deadline timestamptz,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','removed','rejected')),
  removed_at timestamptz,
  handled_by uuid
);

ALTER TABLE public.takedown_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS takedown_admin_all ON public.takedown_orders;
CREATE POLICY takedown_admin_all ON public.takedown_orders
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
GRANT SELECT, INSERT, UPDATE ON public.takedown_orders TO authenticated;
GRANT ALL ON public.takedown_orders TO service_role;

CREATE OR REPLACE FUNCTION public.takedown_set_sla() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.sla_deadline := NEW.received_at +
    CASE WHEN NEW.source = 'ncii_csam' THEN interval '2 hours' ELSE interval '3 hours' END;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS takedown_sla ON public.takedown_orders;
CREATE TRIGGER takedown_sla BEFORE INSERT OR UPDATE OF received_at, source
  ON public.takedown_orders FOR EACH ROW EXECUTE FUNCTION public.takedown_set_sla();
