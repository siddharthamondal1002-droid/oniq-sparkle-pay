-- ₹75 A MINUTE (owner directive, 2026-08-16). Was ₹57.
--
-- THE OLD RATE SOLVED THE WRONG EQUATION. pricePaisePerMinute targeted a 26%
-- margin BEFORE tax, published ₹57, and the business banked 11.2% — because
-- the published price is GST-inclusive, so 18/118 of every rupee taken is tax
-- passing through. That gap was reported on 2026-08-16 and left for the owner
-- rather than silently closed; this is the owner closing it.
--
-- The floor that restores the mandate NET OF GST is ₹72/min. ₹75 is the
-- owner's round number above that floor, and it lands the realised margin at
-- 28.3% for a one-minute film rising to 31.5% at five, as the flat ₹3 per film
-- is spread. pricePaisePerMinute now solves for the net-of-GST mandate, so the
-- number it returns is a floor anybody can stand on, and a test holds the
-- published rate against it — a cost rise that eats the ₹3 gap fails CI rather
-- than quietly eating the margin.
--
-- CLASSIC IS UNTOUCHED AND STAYS WITHDRAWN (2026-08-15). Its rate is left at
-- ₹49 because nothing is on sale at it; repricing a withdrawn product would
-- only create a second number to keep true.
--
-- STILL A RATE, NOT A LADDER. Every row is ₹75 x minutes. No duration carries
-- a price of its own, which is the no-tiers policy from 2026-08-15 and the
-- thing the linearity test asserts against this file.

update public.story_price_tiers
   set price_paise = round(7500.0 * seconds / 60)
 where grade = 'movie';

-- The canonical chart after the change, for anyone reading this file rather
-- than the table:
--   movie  60s  ₹75     120s ₹150
--   movie 180s  ₹225    300s ₹375
