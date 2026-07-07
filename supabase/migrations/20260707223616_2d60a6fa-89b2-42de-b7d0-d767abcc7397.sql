
-- ============================================================
-- ONIQ LEARN — courses, lessons, progress, stats
-- ============================================================

CREATE TABLE public.learn_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  emoji text NOT NULL DEFAULT '📘',
  description text,
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.learn_courses TO authenticated;
GRANT ALL ON public.learn_courses TO service_role;
ALTER TABLE public.learn_courses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "courses readable by authed" ON public.learn_courses FOR SELECT TO authenticated USING (true);

CREATE TABLE public.learn_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.learn_courses ON DELETE CASCADE,
  title text NOT NULL,
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.learn_lessons TO authenticated;
GRANT ALL ON public.learn_lessons TO service_role;
ALTER TABLE public.learn_lessons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lessons readable by authed" ON public.learn_lessons FOR SELECT TO authenticated USING (true);

CREATE TABLE public.learn_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES public.learn_lessons ON DELETE CASCADE,
  prompt text NOT NULL,
  options text[] NOT NULL,
  correct_index int NOT NULL CHECK (correct_index >= 0 AND correct_index <= 3),
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.learn_questions TO authenticated;
GRANT ALL ON public.learn_questions TO service_role;
ALTER TABLE public.learn_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "questions readable by authed" ON public.learn_questions FOR SELECT TO authenticated USING (true);

CREATE TABLE public.learn_progress (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES public.learn_lessons ON DELETE CASCADE,
  completed_at timestamptz DEFAULT now(),
  score int NOT NULL,
  PRIMARY KEY(user_id, lesson_id)
);
GRANT SELECT ON public.learn_progress TO authenticated;
GRANT ALL ON public.learn_progress TO service_role;
ALTER TABLE public.learn_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "progress own read" ON public.learn_progress FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.learn_stats (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  xp int NOT NULL DEFAULT 0,
  streak int NOT NULL DEFAULT 0,
  last_active date
);
GRANT SELECT ON public.learn_stats TO authenticated;
GRANT ALL ON public.learn_stats TO service_role;
ALTER TABLE public.learn_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stats own read" ON public.learn_stats FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ============ RPC: complete_lesson ============
CREATE OR REPLACE FUNCTION public.complete_lesson(_lesson_id uuid, _score int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  existing_score int;
  is_first boolean := false;
  awarded int := 0;
  today date := current_date;
  prev_last date;
  new_streak int;
  new_xp int;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _score IS NULL OR _score < 0 OR _score > 100 THEN RAISE EXCEPTION 'invalid score'; END IF;
  IF NOT EXISTS (SELECT 1 FROM learn_lessons WHERE id = _lesson_id) THEN
    RAISE EXCEPTION 'lesson not found';
  END IF;

  SELECT score INTO existing_score FROM learn_progress WHERE user_id = me AND lesson_id = _lesson_id;
  IF existing_score IS NULL THEN
    is_first := true;
    INSERT INTO learn_progress (user_id, lesson_id, score) VALUES (me, _lesson_id, _score);
    awarded := 10 + round(_score::numeric / 10)::int;
  ELSE
    UPDATE learn_progress SET score = GREATEST(existing_score, _score), completed_at = now()
    WHERE user_id = me AND lesson_id = _lesson_id;
  END IF;

  SELECT last_active INTO prev_last FROM learn_stats WHERE user_id = me;
  IF prev_last IS NULL THEN
    new_streak := 1;
  ELSIF prev_last = today THEN
    SELECT streak INTO new_streak FROM learn_stats WHERE user_id = me;
  ELSIF prev_last = today - 1 THEN
    SELECT streak + 1 INTO new_streak FROM learn_stats WHERE user_id = me;
  ELSE
    new_streak := 1;
  END IF;

  INSERT INTO learn_stats (user_id, xp, streak, last_active)
  VALUES (me, awarded, new_streak, today)
  ON CONFLICT (user_id) DO UPDATE
    SET xp = learn_stats.xp + EXCLUDED.xp,
        streak = EXCLUDED.streak,
        last_active = EXCLUDED.last_active
  RETURNING xp INTO new_xp;

  RETURN jsonb_build_object('xp', new_xp, 'streak', new_streak, 'first_time', is_first, 'awarded', awarded);
END; $$;

REVOKE ALL ON FUNCTION public.complete_lesson(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_lesson(uuid, int) TO authenticated;

-- ============ SEED: Bengali Basics ============
DO $$
DECLARE
  c uuid;
  l1 uuid; l2 uuid; l3 uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM learn_courses WHERE title = 'Bengali Basics') THEN
    INSERT INTO learn_courses (title, emoji, description, sort)
    VALUES ('Bengali Basics', '🇮🇳', 'Kickstart your Bangla with everyday phrases.', 0)
    RETURNING id INTO c;

    INSERT INTO learn_lessons (course_id, title, sort) VALUES (c, 'Greetings', 0) RETURNING id INTO l1;
    INSERT INTO learn_lessons (course_id, title, sort) VALUES (c, 'Numbers', 1) RETURNING id INTO l2;
    INSERT INTO learn_lessons (course_id, title, sort) VALUES (c, 'Food', 2) RETURNING id INTO l3;

    -- Greetings
    INSERT INTO learn_questions (lesson_id, prompt, options, correct_index, sort) VALUES
      (l1, 'Hello',        ARRAY['নমস্কার','ধন্যবাদ','হ্যাঁ','না'], 0, 0),
      (l1, 'Thank you',    ARRAY['ভালো আছি','ধন্যবাদ','দুঃখিত','বিদায়'], 1, 1),
      (l1, 'Yes',          ARRAY['না','হ্যাঁ','হয়তো','কেন'], 1, 2),
      (l1, 'No',           ARRAY['না','হ্যাঁ','ঠিক আছে','আচ্ছা'], 0, 3),
      (l1, 'Goodbye',      ARRAY['স্বাগতম','শুভ রাত্রি','বিদায়','সুপ্রভাত'], 2, 4);

    -- Numbers
    INSERT INTO learn_questions (lesson_id, prompt, options, correct_index, sort) VALUES
      (l2, 'One',   ARRAY['এক','দুই','তিন','চার'], 0, 0),
      (l2, 'Two',   ARRAY['তিন','দুই','পাঁচ','এক'], 1, 1),
      (l2, 'Three', ARRAY['চার','দুই','তিন','সাত'], 2, 2),
      (l2, 'Four',  ARRAY['চার','পাঁচ','ছয়','আট'], 0, 3),
      (l2, 'Five',  ARRAY['ছয়','সাত','পাঁচ','নয়'], 2, 4);

    -- Food
    INSERT INTO learn_questions (lesson_id, prompt, options, correct_index, sort) VALUES
      (l3, 'Water',  ARRAY['জল','ভাত','দুধ','চা'], 0, 0),
      (l3, 'Rice',   ARRAY['রুটি','ভাত','মাছ','ডাল'], 1, 1),
      (l3, 'Fish',   ARRAY['মাংস','ডিম','মাছ','সবজি'], 2, 2),
      (l3, 'Tea',    ARRAY['কফি','চা','দুধ','জল'], 1, 3),
      (l3, 'Bread',  ARRAY['রুটি','ভাত','মিষ্টি','তরকারি'], 0, 4);
  END IF;
END $$;
