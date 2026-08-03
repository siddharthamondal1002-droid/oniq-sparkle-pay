ALTER TABLE public.learner_profiles
  ADD COLUMN IF NOT EXISTS edu_system_id TEXT,
  ADD COLUMN IF NOT EXISTS edu_stage TEXT,
  ADD COLUMN IF NOT EXISTS edu_region TEXT;