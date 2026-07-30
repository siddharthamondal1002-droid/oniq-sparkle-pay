-- Quick quizzes previously stored only the score; the per-question sheet
-- (what the student picked vs the right answer + explanation) now persists
-- so attempts can be reviewed later, same as full papers.
ALTER TABLE public.quiz_attempts ADD COLUMN IF NOT EXISTS answer_sheet jsonb;
