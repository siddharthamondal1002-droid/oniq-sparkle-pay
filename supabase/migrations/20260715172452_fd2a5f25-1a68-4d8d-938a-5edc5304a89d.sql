
CREATE TABLE public.learner_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  board text NOT NULL CHECK (board IN ('cbse','icse','igcse','college')),
  class_level text NOT NULL CHECK (class_level IN ('5','6','7','8','9','10','11','12','ug','pg')),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.learner_profiles TO authenticated;
GRANT ALL ON public.learner_profiles TO service_role;

ALTER TABLE public.learner_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their learner profiles"
  ON public.learner_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Owners can create learner profiles"
  ON public.learner_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owners can update their learner profiles"
  ON public.learner_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owners can delete their learner profiles"
  ON public.learner_profiles FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX learner_profiles_user_id_idx ON public.learner_profiles(user_id, created_at DESC);
