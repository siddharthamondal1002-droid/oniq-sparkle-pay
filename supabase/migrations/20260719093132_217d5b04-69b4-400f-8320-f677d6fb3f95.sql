CREATE TABLE public.chapter_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board text NOT NULL,
  class_level text NOT NULL,
  subject text NOT NULL,
  chapter text NOT NULL,
  content text NOT NULL,
  source_note text NOT NULL DEFAULT 'AI-generated study notes — verify against your exact textbook edition',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chapter_notes_uniq UNIQUE (board, class_level, subject, chapter)
);

GRANT SELECT ON public.chapter_notes TO authenticated;
GRANT ALL ON public.chapter_notes TO service_role;

ALTER TABLE public.chapter_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chapter_notes readable by authenticated"
  ON public.chapter_notes FOR SELECT TO authenticated USING (true);
