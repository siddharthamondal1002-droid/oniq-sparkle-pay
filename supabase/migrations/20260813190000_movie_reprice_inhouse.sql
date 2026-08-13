-- Reprice the movie grade to the IN-HOUSE engine's cost.
--
-- OWNER DIRECTIVE (2026-08-13): the movie grade is the HOME-GROWN process —
-- the owned cinematography stack (multi-plane parallax, rigged characters,
-- VFX layers, dialogue voices, film look), not rented video generation. Its
-- marginal cost is classic's stills and voices plus render compute (classic
-- measured 4.5 runner-minutes per finished minute; the richer movie
-- composition is budgeted at 2x, priced at the runner's overage rate so the
-- chart stays honest past the free tier). storyCostModel.ts carries the
-- units; every row below sits within 1.5 points of the mandated 28/26/21
-- margins and CI asserts it. The 30s row publishes one rounding step below
-- the formula's ceil — ₹32 lands 2.1 points OVER the mandate purely from
-- rounding a tiny price up, and the margin is the requirement, not the ceil.
--
-- MOVIE ROWS STAY INACTIVE until the in-house movie engine ships as the
-- worker's movie renderer. Selling this chart while the movie path still
-- rents its motion would sell at a tenth of that cost — activation waits for
-- the engine, exactly as the chart has always waited for its pipeline.
--
-- ONE CANONICAL CHART: classic rows unchanged, restated so this newest
-- pricing migration is the single statement the SQL mirror test reads.

insert into public.story_price_tiers (seconds, label, price_paise, sort_order, grade, active) values
  (30,  '30 seconds',         2700,  1,  'classic', true),
  (60,  '1 minute',           4800,  2,  'classic', true),
  (120, '2 minutes',          9200,  3,  'classic', true),
  (180, '3 minutes',          12600, 4,  'classic', true),
  (300, '5 minutes',          20800, 5,  'classic', true),
  (30,  '30 seconds — movie', 3100,  6,  'movie',   false),
  (60,  '1 minute — movie',   5700,  7,  'movie',   false),
  (120, '2 minutes — movie',  10900, 8,  'movie',   false),
  (180, '3 minutes — movie',  15000, 9,  'movie',   false),
  (300, '5 minutes — movie',  24700, 10, 'movie',   false)
on conflict (seconds, grade) do update
  set label = excluded.label,
      price_paise = excluded.price_paise,
      sort_order = excluded.sort_order,
      updated_at = now();
-- Deliberately NOT updating `active` on conflict: whether a tier is on sale
-- is operational state flipped by hand, and a repricing must never silently
-- re-enable or disable a product.
