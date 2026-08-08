ALTER TABLE public.video_gen_config
  ADD COLUMN IF NOT EXISTS episodes_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS episode_daily_cap integer NOT NULL DEFAULT 5;

CREATE TABLE IF NOT EXISTS public.episode_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL,
  title text,
  status text NOT NULL DEFAULT 'queued',
  timeline jsonb NOT NULL,
  total_seconds numeric NOT NULL,
  stored_path text,
  error text,
  notes jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT episode_jobs_status_chk CHECK (status IN ('queued','running','succeeded','failed'))
);

GRANT SELECT ON public.episode_jobs TO authenticated;
GRANT ALL ON public.episode_jobs TO service_role;

ALTER TABLE public.episode_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read episode jobs"
  ON public.episode_jobs FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS episode_jobs_status_idx ON public.episode_jobs (status);
CREATE INDEX IF NOT EXISTS episode_jobs_created_at_idx ON public.episode_jobs (created_at DESC);

CREATE OR REPLACE FUNCTION public.episode_jobs_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.episode_jobs_touch_updated_at() FROM anon, authenticated;

CREATE TRIGGER update_episode_jobs_updated_at
  BEFORE UPDATE ON public.episode_jobs
  FOR EACH ROW EXECUTE FUNCTION public.episode_jobs_touch_updated_at();