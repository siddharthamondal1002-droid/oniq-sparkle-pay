-- Reprice the movie grade to its MEASURED cost, margins held at the mandate.
--
-- OWNER DIRECTIVE (2026-08-13): "fix price accordingly", after the first live
-- movie films measured what a finished minute actually buys. The worker's
-- duration ladder asks Veo for 4, 6 or 8 seconds per shot against the shot's
-- narration, and at 8.7 shots/minute the asks sum to ~68 video-seconds per
-- finished minute — not the 60 the original chart assumed. Priced on 60, a
-- full-success film realises ~17% margin against the 26% mandate.
--
-- storyCostModel.ts now carries videoSecondsPerFinishedMinute = 68 and these
-- rows are priceFor()'s output at the mandated 28/26/21 margins, each within
-- 1.5 points (CI asserts it). Classic rows are unchanged and restated only so
-- this remains the ONE CANONICAL CHART the SQL mirror test reads.
--
-- MOVIE ROWS STAY INACTIVE. Repricing is not launching: the Google key's Veo
-- daily quota (~75s/day, measured 2026-08-13) cannot serve even two movie
-- films a day, so the grade stays admin-only until that is raised.

insert into public.story_price_tiers (seconds, label, price_paise, sort_order, grade, active) values
  (30,  '30 seconds',         2700,   1,  'classic', true),
  (60,  '1 minute',           4800,   2,  'classic', true),
  (120, '2 minutes',          9200,   3,  'classic', true),
  (180, '3 minutes',          12600,  4,  'classic', true),
  (300, '5 minutes',          20800,  5,  'classic', true),
  (30,  '30 seconds — movie', 64200,  6,  'movie',   false),
  (60,  '1 minute — movie',   124400, 7,  'movie',   false),
  (120, '2 minutes — movie',  248400, 8,  'movie',   false),
  (180, '3 minutes — movie',  348000, 9,  'movie',   false),
  (300, '5 minutes — movie',  579800, 10, 'movie',   false)
on conflict (seconds, grade) do update
  set label = excluded.label,
      price_paise = excluded.price_paise,
      sort_order = excluded.sort_order,
      updated_at = now();
-- Deliberately NOT updating `active` on conflict: whether a tier is on sale
-- is operational state flipped by hand, and a repricing must never silently
-- re-enable or disable a product.
