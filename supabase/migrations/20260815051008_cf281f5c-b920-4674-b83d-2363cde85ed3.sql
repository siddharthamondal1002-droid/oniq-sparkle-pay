-- PER-MINUTE PRICING — the tiers stop being tiers.
--
-- Owner directive, 2026-08-15: "remove tiers, keep on per min cost", and the
-- measured generation cost is ₹31.50 per finished minute. Margin: 26%.
--
-- WHAT CHANGED. Until now each duration carried its own margin — 28% on the
-- shortest, 26% mid, 21% on the longest — so five rows meant five different
-- takes and a price could only be reasoned about one row at a time. There is
-- now ONE RATE per grade and every published amount is that rate times the
-- minutes bought:
--
--   classic  ₹49/min      movie  ₹57/min
--
-- Derived, not chosen: rate = (generation + ₹3 infra) / (1 - 0.26 - 0.0236),
-- rounded up to the whole rupee, where generation is ₹31.50/min for stills
-- and voices plus ₹6.05/min of ONIQ's own render compute for movie grade.
-- src/lib/storyCostModel.ts is the formula and CI parses THIS FILE against
-- it, so the two cannot drift.
--
-- WHY THE COST NUMBER MOVED. The old chart was built on a DERIVATION from USD
-- list prices (8.7 shots x $0.039 + $0.032 TTS = ₹31.19/min) — an estimate of
-- a bill nobody had seen. ₹31.50 is measured. It lands close, which is
-- reassuring, but it is now the authority.
--
-- THE 30-SECOND ROW SITS BELOW THE MANDATE, deliberately and visibly. A flat
-- ₹3 per-film infrastructure cost cannot be recovered by a per-minute price:
-- half a minute collects half the flat cost and pays all of it, so 30s lands
-- at ~21% against the 26% floor while every duration from one minute up sits
-- at or above it (27% at 1 min, rising to 32% at 5). Fixing that needs either
-- a two-part tariff (rate x minutes PLUS a flat fee), which is not a
-- per-minute price, or dropping the sub-minute option. Left as-is pending the
-- owner's call rather than quietly papered over with a non-linear row —
-- a row that broke the line would be a tier again.
--
-- ACTIVE FLAGS UNCHANGED from the 2026-08-13 launch directive: movie on sale,
-- classic held back.

insert into public.story_price_tiers (seconds, label, price_paise, sort_order, grade, active) values
  (30,  '30 seconds',         2450,  1,  'classic', false),
  (60,  '1 minute',           4900,  2,  'classic', false),
  (120, '2 minutes',          9800,  3,  'classic', false),
  (180, '3 minutes',          14700, 4,  'classic', false),
  (300, '5 minutes',          24500, 5,  'classic', false),
  (30,  '30 seconds — movie', 2850,  6,  'movie',   true),
  (60,  '1 minute — movie',   5700,  7,  'movie',   true),
  (120, '2 minutes — movie',  11400, 8,  'movie',   true),
  (180, '3 minutes — movie',  17100, 9,  'movie',   true),
  (300, '5 minutes — movie',  28500, 10, 'movie',   true)
on conflict (seconds, grade) do update
  set label       = excluded.label,
      price_paise = excluded.price_paise,
      sort_order  = excluded.sort_order,
      active      = excluded.active;

comment on table public.story_price_tiers is
  'Durations on sale, priced at a single per-minute rate per grade (owner directive 2026-08-15: classic ₹49/min, movie ₹57/min, 26% margin). Every price_paise is rate x minutes — no row carries a price of its own, and a row that broke that line would be a tier again.';