
CREATE TABLE public.study_papers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.learner_profiles(id) ON DELETE CASCADE,
  subject text NOT NULL,
  total_marks int NOT NULL,
  questions jsonb NOT NULL,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  marks_scored int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX study_papers_profile_created_idx
  ON public.study_papers (profile_id, created_at);

-- Only the service role (used inside edge functions) can touch this table.
GRANT ALL ON public.study_papers TO service_role;

-- RLS enabled with ZERO policies for authenticated/anon => default-deny.
-- Ownership checks are enforced in the edge-function code instead of RLS,
-- because the client must never see the correct_index / model_answer /
-- rubric_points columns of the questions jsonb.
ALTER TABLE public.study_papers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS total_marks int,
  ADD COLUMN IF NOT EXISTS marks_scored int;
