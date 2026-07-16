ALTER TABLE public.study_papers
  ADD COLUMN IF NOT EXISTS draft_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.study_papers DROP CONSTRAINT IF EXISTS study_papers_status_check;
ALTER TABLE public.study_papers ADD CONSTRAINT study_papers_status_check
  CHECK (status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'abandoned'::text]));

CREATE INDEX IF NOT EXISTS study_papers_profile_subject_status_idx
  ON public.study_papers (profile_id, subject, status, updated_at DESC);