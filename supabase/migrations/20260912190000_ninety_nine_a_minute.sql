-- ₹99 A MINUTE (owner directive, 2026-09-12). Was ₹75.
--
-- The owner set the per-minute price users pay for video at ₹99. This is the
-- table that charges: `create_story_purchase` reads a row of it under the row
-- that becomes the receipt, and `/pay/story` renders the rows live, so the
-- UPDATE below is the price change — no deploy, effective on the next read.
--
-- WHICH PRICE THIS IS, because ONIQ carries two and only one of them bills.
-- `video_sale_config` (the PAYG video-time ledger, ₹29/min + ₹20 clean) has
-- sales_enabled = false and has never sold a minute; `story_price_tiers` is
-- what a person buys through, and its movie rows are the active ones. Setting
-- the dormant chart would have changed a number nobody is charged.
--
-- MOVIE ONLY. Every film a user claims is movie grade — StoryStudio sends
-- `_grade: "movie"` unconditionally since classic was withdrawn (2026-08-15) —
-- and the classic rows are active = false. Repricing a withdrawn product would
-- only create a second number to keep true, which is the reason the ₹75
-- migration left classic at ₹49 and this one does the same.
--
-- MARGIN. ₹99 sits above the ₹72/min floor `pricePaisePerMinute("movie")`
-- solves for net of GST, so this raises the realised margin rather than
-- testing it; the floor test still holds the published rate against the
-- derivation, and a cost rise that ate the gap would still fail CI.
--
-- STILL A RATE, NOT A LADDER. Every row is ₹99 x minutes. No duration carries
-- a price of its own — the no-tiers policy from 2026-08-15, and the thing the
-- linearity test asserts against this file.

update public.story_price_tiers
   set price_paise = round(9900.0 * seconds / 60)
 where grade = 'movie';

-- The canonical chart after the change, for anyone reading this file rather
-- than the table:
--   movie  60s  ₹99     120s ₹198
--   movie 180s  ₹297    300s ₹495
