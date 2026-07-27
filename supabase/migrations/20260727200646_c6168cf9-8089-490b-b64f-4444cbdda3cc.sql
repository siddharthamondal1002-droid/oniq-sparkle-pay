ALTER TABLE public.study_papers
  ADD COLUMN IF NOT EXISTS answer_sheet jsonb;