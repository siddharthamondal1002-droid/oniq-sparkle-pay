
ALTER TABLE public.learner_profiles DROP CONSTRAINT IF EXISTS learner_profiles_board_check;
ALTER TABLE public.learner_profiles DROP CONSTRAINT IF EXISTS learner_profiles_class_level_check;

ALTER TABLE public.learner_profiles ADD CONSTRAINT learner_profiles_board_check
  CHECK (board IN ('cbse','icse','igcse','college','jee','neet','clat','govt_exam'));

ALTER TABLE public.learner_profiles ADD CONSTRAINT learner_profiles_class_level_check
  CHECK (class_level IN ('5','6','7','8','9','10','11','12','ug','pg','drop','aspirant'));
