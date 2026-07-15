
CREATE TABLE public.quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.learner_profiles(id) ON DELETE CASCADE,
  subject text NOT NULL,
  topic text NOT NULL,
  total_questions int NOT NULL,
  correct_count int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.quiz_attempts TO authenticated;
GRANT ALL ON public.quiz_attempts TO service_role;

ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner can read quiz attempts"
  ON public.quiz_attempts FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.learner_profiles lp
    WHERE lp.id = quiz_attempts.profile_id AND lp.user_id = auth.uid()
  ));

CREATE POLICY "owner can insert quiz attempts"
  ON public.quiz_attempts FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.learner_profiles lp
    WHERE lp.id = quiz_attempts.profile_id AND lp.user_id = auth.uid()
  ));

CREATE INDEX quiz_attempts_profile_created_idx
  ON public.quiz_attempts (profile_id, created_at DESC);
