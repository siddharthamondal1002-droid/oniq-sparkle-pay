ALTER TABLE public.learner_profiles DROP CONSTRAINT learner_profiles_board_check;
ALTER TABLE public.learner_profiles ADD CONSTRAINT learner_profiles_board_check CHECK (board = ANY (ARRAY[
  'cbse','icse','igcse','college','jee','neet','clat',
  'govt_exam','govt_railway','govt_banking','govt_police','govt_judiciary','govt_ssc','govt_psc',
  'nios','up_board','bihar_board','rajasthan_board','mp_board','haryana_board','punjab_board',
  'uttarakhand_board','himachal_board','jk_board','jharkhand_board','chhattisgarh_board',
  'maharashtra_board','tn_board','kerala_board','wb_board','gujarat_board','karnataka_board',
  'ap_board','telangana_board','ib'
]));