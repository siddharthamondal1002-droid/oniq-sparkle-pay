-- B4: tamper-evident provenance. SHA-256 of uploaded bytes recorded per
-- media item; rows are insert-once (no user UPDATE/DELETE policies), so a
-- later hash mismatch evidences tampering. No content stored.
CREATE TABLE IF NOT EXISTS public.media_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  uploader_id uuid NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('moment','clip','avatar','chat','other')),
  content_id text,
  sha256 text NOT NULL,
  origin text NOT NULL DEFAULT 'user_upload',
  declared_synthetic boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS media_provenance_content_idx
  ON public.media_provenance (content_type, content_id);

ALTER TABLE public.media_provenance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provenance_insert_own ON public.media_provenance;
CREATE POLICY provenance_insert_own ON public.media_provenance
  FOR INSERT TO authenticated WITH CHECK (uploader_id = auth.uid());
DROP POLICY IF EXISTS provenance_select ON public.media_provenance;
CREATE POLICY provenance_select ON public.media_provenance
  FOR SELECT TO authenticated
  USING (uploader_id = auth.uid() OR public.is_admin(auth.uid()));
-- No UPDATE/DELETE policies: append-only for authenticated users.
GRANT SELECT, INSERT ON public.media_provenance TO authenticated;
GRANT ALL ON public.media_provenance TO service_role;
