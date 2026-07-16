ALTER TABLE public.learner_profiles DROP CONSTRAINT IF EXISTS learner_profiles_board_check;
ALTER TABLE public.learner_profiles ADD CONSTRAINT learner_profiles_board_check
  CHECK (board IN ('cbse','icse','igcse','college','jee','neet','clat','govt_exam','govt_railway','govt_banking','govt_police','govt_judiciary','govt_ssc','govt_psc'));