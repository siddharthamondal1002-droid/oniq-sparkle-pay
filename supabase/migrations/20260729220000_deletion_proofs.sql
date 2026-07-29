-- B2 (phone-friendly): dated deletion-proof reports, written ONLY by the
-- deletion-proof edge function (service role). Admins read; nobody writes
-- from the client (no INSERT/UPDATE/DELETE policies for authenticated).
CREATE TABLE IF NOT EXISTS public.deletion_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  run_by uuid NOT NULL,
  test_uid uuid NOT NULL,
  test_email text NOT NULL,
  tables_checked int NOT NULL,
  buckets_checked int NOT NULL,
  residues jsonb NOT NULL DEFAULT '[]'::jsonb,
  pass boolean NOT NULL,
  report_sha256 text NOT NULL
);
ALTER TABLE public.deletion_proofs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deletion_proofs_admin_select ON public.deletion_proofs;
CREATE POLICY deletion_proofs_admin_select ON public.deletion_proofs
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
GRANT SELECT ON public.deletion_proofs TO authenticated;
GRANT ALL ON public.deletion_proofs TO service_role;
