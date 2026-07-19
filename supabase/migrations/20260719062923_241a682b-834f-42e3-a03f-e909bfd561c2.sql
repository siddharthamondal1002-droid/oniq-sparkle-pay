
CREATE TABLE public.chapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board text NOT NULL,
  class_level text NOT NULL,
  subject text NOT NULL,
  chapter_number int NOT NULL,
  chapter_title text NOT NULL,
  source_note text NOT NULL DEFAULT 'AI-generated from standard board structure — verify against your exact textbook edition',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chapters_unique UNIQUE (board, class_level, subject, chapter_number)
);

GRANT SELECT ON public.chapters TO authenticated;
GRANT ALL ON public.chapters TO service_role;

ALTER TABLE public.chapters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can read chapters"
  ON public.chapters FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX chapters_lookup_idx ON public.chapters (board, class_level, subject, chapter_number);

ALTER TABLE public.study_notes ADD COLUMN chapter text;
