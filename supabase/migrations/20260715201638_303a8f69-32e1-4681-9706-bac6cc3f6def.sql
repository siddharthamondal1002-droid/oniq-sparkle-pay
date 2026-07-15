
CREATE TABLE public.study_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.learner_profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  used_vault boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX study_messages_profile_created_idx
  ON public.study_messages (profile_id, created_at);

GRANT SELECT, INSERT ON public.study_messages TO authenticated;
GRANT ALL ON public.study_messages TO service_role;

ALTER TABLE public.study_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can read their learner's study messages"
  ON public.study_messages FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.learner_profiles lp
    WHERE lp.id = study_messages.profile_id AND lp.user_id = auth.uid()
  ));

CREATE POLICY "Owners can insert study messages for their learner"
  ON public.study_messages FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.learner_profiles lp
    WHERE lp.id = study_messages.profile_id AND lp.user_id = auth.uid()
  ));
