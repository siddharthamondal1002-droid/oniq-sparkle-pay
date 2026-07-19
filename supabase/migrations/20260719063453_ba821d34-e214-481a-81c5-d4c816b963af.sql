ALTER TABLE public.quiz_attempts ADD COLUMN IF NOT EXISTS chapter TEXT NULL;
CREATE INDEX IF NOT EXISTS quiz_attempts_profile_subject_chapter_idx
  ON public.quiz_attempts (profile_id, subject, chapter);