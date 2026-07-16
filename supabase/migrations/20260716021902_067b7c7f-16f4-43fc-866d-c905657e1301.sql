ALTER TABLE public.quiz_attempts ALTER COLUMN total_questions DROP NOT NULL;
ALTER TABLE public.quiz_attempts ALTER COLUMN correct_count DROP NOT NULL;