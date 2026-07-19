CREATE TABLE public.study_chapters_debug (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board text,
  class_level text,
  subject text,
  source text,
  reason text,
  stop_reason text,
  blocks_snippet text,
  http_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.study_chapters_debug TO service_role;
ALTER TABLE public.study_chapters_debug ENABLE ROW LEVEL SECURITY;