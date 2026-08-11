-- Reprice the whole chart to the mandated margin policy.
--
-- OWNER DIRECTIVE (2026-08-11): infrastructure cost met, and ONIQ's margin
-- set BY DURATION — 28% on the shortest films, 26% mid, 21% on the longest.
-- The longer the film, the thinner the take: quality at affordable prices,
-- discount deepening with commitment. src/lib/storyCostModel.ts holds the
-- formula (generation cost + ₹3 fixed infra + Razorpay's 2.36%-of-price fee,
-- then the margin on top, rounded up to the rupee) and CI asserts every row
-- below sits within 1.5 points of its mandated margin.
--
-- CLASSIC PRICES DROP SHARPLY (₹49→₹27 for 30s, ₹399→₹208 for 5min): the old
-- chart carried ~65% margins from before the policy existed. Movie rows stay
-- INACTIVE — repriced now so the chart is ready, sold only when the clip
-- stage ships.
--
-- ONE CANONICAL CHART. This upsert lists every row of both grades, so the
-- newest pricing migration is the single place the current chart can be read
-- from — and the SQL mirror test reads exactly this statement.

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
-- Deliberately NOT updating `active` on conflict: whether a tier is on sale
-- is operational state flipped by hand, and a repricing must never silently
-- re-enable or disable a product.
