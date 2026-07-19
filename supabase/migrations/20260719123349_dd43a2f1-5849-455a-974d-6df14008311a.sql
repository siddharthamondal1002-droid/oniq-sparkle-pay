
CREATE TABLE public.chapter_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_profile_id uuid NOT NULL REFERENCES public.learner_profiles(id) ON DELETE CASCADE,
  subject text NOT NULL,
  chapter_number integer NOT NULL CHECK (chapter_number >= 1 AND chapter_number <= 200),
  chapter_title text NOT NULL CHECK (length(chapter_title) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (learner_profile_id, subject, chapter_number)
);

CREATE INDEX chapter_overrides_profile_subject_idx
  ON public.chapter_overrides (learner_profile_id, subject, chapter_number);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chapter_overrides TO authenticated;
GRANT ALL ON public.chapter_overrides TO service_role;

ALTER TABLE public.chapter_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view chapter overrides"
  ON public.chapter_overrides FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.learner_profiles lp
    WHERE lp.id = chapter_overrides.learner_profile_id AND lp.user_id = auth.uid()
  ));

CREATE POLICY "Owners can insert chapter overrides"
  ON public.chapter_overrides FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.learner_profiles lp
    WHERE lp.id = chapter_overrides.learner_profile_id AND lp.user_id = auth.uid()
  ));

CREATE POLICY "Owners can update chapter overrides"
  ON public.chapter_overrides FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.learner_profiles lp
    WHERE lp.id = chapter_overrides.learner_profile_id AND lp.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.learner_profiles lp
    WHERE lp.id = chapter_overrides.learner_profile_id AND lp.user_id = auth.uid()
  ));

CREATE POLICY "Owners can delete chapter overrides"
  ON public.chapter_overrides FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.learner_profiles lp
    WHERE lp.id = chapter_overrides.learner_profile_id AND lp.user_id = auth.uid()
  ));

CREATE TRIGGER chapter_overrides_touch_updated_at
  BEFORE UPDATE ON public.chapter_overrides
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Seed Bihu's real ICSE Class 9 syllabus for both ICSE Bihu profiles
-- (Loreto Day School, Elliot Road — 2026-27 Scheme of Work).
WITH bihu_profiles AS (
  SELECT id FROM public.learner_profiles
  WHERE name = 'Bihu' AND board = 'icse' AND class_level = '9'
),
english_chapters(n, t) AS (VALUES
  (1, 'Julius Caesar – Act I'),
  (2, 'Oliver Asks for More'),
  (3, 'Night Mail'),
  (4, 'Bonku Babu''s Friend'),
  (5, 'Skimbleshanks'),
  (6, 'The Model Millionaire'),
  (7, 'I Remember, I Remember'),
  (8, 'Julius Caesar – Act II'),
  (9, 'The Homecoming'),
  (10, 'A Work of Artifice'),
  (11, 'A Doctor''s Journal Entry from August 6, 1945'),
  (12, 'The Boy Who Broke the Bank')
),
hindi_chapters(n, t) AS (VALUES
  (1, 'बात अठन्नी की'),
  (2, 'साखी'),
  (3, 'काकी'),
  (4, 'महाजन का पुरस्कार'),
  (5, 'गिरिधर की कुंडलियाँ'),
  (6, 'स्वर्ग बना सकते हैं'),
  (7, 'नेता जी का चश्मा'),
  (8, 'अपना-अपना भाग्य'),
  (9, 'वह जन्मभूमि मेरी'),
  (10, 'मेघ आए'),
  (11, 'व्याकरण (Grammar practice)'),
  (12, 'निबंध (Essay writing)'),
  (13, 'पत्र-लेखन (Letter writing)'),
  (14, 'अपठित गद्यांश (Unseen passage practice)')
)
INSERT INTO public.chapter_overrides (learner_profile_id, subject, chapter_number, chapter_title)
SELECT bp.id, 'English', ec.n, ec.t FROM bihu_profiles bp, english_chapters ec
UNION ALL
SELECT bp.id, 'Hindi', hc.n, hc.t FROM bihu_profiles bp, hindi_chapters hc
ON CONFLICT (learner_profile_id, subject, chapter_number) DO NOTHING;
