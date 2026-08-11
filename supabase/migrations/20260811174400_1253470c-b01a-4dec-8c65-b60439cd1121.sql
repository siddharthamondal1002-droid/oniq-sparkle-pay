insert into public.story_price_tiers (seconds, label, price_paise, sort_order, grade, active) values
  (30,  '30 seconds',         2700,   1,  'classic', true),
  (60,  '1 minute',           4800,   2,  'classic', true),
  (120, '2 minutes',          9200,   3,  'classic', true),
  (180, '3 minutes',          12600,  4,  'classic', true),
  (300, '5 minutes',          20800,  5,  'classic', true),
  (30,  '30 seconds — movie', 57000,  6,  'movie',   false),
  (60,  '1 minute — movie',   110300, 7,  'movie',   false),
  (120, '2 minutes — movie',  220200, 8,  'movie',   false),
  (180, '3 minutes — movie',  308600, 9,  'movie',   false),
  (300, '5 minutes — movie',  514000, 10, 'movie',   false)
on conflict (seconds, grade) do update
  set label = excluded.label,
      price_paise = excluded.price_paise,
      sort_order = excluded.sort_order,
      updated_at = now();