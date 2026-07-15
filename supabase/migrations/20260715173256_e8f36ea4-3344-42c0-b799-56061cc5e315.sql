
CREATE TABLE public.study_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board text NOT NULL CHECK (board IN ('cbse','icse','igcse','college')),
  class_level text NOT NULL CHECK (class_level IN ('5','6','7','8','9','10','11','12','ug','pg')),
  subject text NOT NULL,
  topic text NOT NULL,
  content text NOT NULL,
  source text NOT NULL DEFAULT 'tutor',
  created_at timestamptz NOT NULL DEFAULT now(),
  search tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(topic,'') || ' ' || coalesce(subject,'') || ' ' || coalesce(content,''))
  ) STORED
);

GRANT SELECT ON public.study_notes TO authenticated;
GRANT ALL ON public.study_notes TO service_role;

ALTER TABLE public.study_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read study notes"
  ON public.study_notes FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX study_notes_search_idx ON public.study_notes USING GIN (search);
CREATE INDEX study_notes_board_class_idx ON public.study_notes (board, class_level);
