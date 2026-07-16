ALTER TABLE public.study_papers
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'marks',
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS duration_seconds integer;

ALTER TABLE public.study_papers
  DROP CONSTRAINT IF EXISTS study_papers_kind_check;

ALTER TABLE public.study_papers
  ADD CONSTRAINT study_papers_kind_check
  CHECK (kind IN ('marks','mock'));