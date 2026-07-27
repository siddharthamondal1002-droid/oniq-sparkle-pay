-- Answer sheets for completed study papers: at finish time the app stores
-- each question's student answer + per-question grading, so learners can
-- reopen any past paper, see their mistakes, and compare against the model
-- answers (which the review endpoint reveals only after completion).
ALTER TABLE public.study_papers
  ADD COLUMN IF NOT EXISTS answer_sheet jsonb;
