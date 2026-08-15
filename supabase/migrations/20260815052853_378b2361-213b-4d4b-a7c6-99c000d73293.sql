-- THE 30-SECOND FILM IS WITHDRAWN.
--
-- Owner directive, 2026-08-15, taken immediately after the per-minute reprice
-- exposed the problem it could not solve.
--
-- WHY. One rate, 26% margin, every price = rate x minutes. That works for
-- every duration except the sub-minute one, because a flat ₹3 per-film
-- infrastructure cost is NOT RECOVERABLE BY A PER-MINUTE PRICE: half a minute
-- pays all of the flat cost and collects half the rate, landing at ~21%
-- against a 26% floor while one minute sits at 27% and five at 32%.
--
-- The two ways out were a two-part tariff (rate x minutes PLUS a flat fee),
-- which is not a per-minute price and so contradicts the directive, or
-- withdrawing the option. The owner chose withdrawal. The alternative nobody
-- chose — bending the 30s row up to clear the floor — would have put a row
-- off the rate line, and a row off the line is a tier again.
--
-- SAFE TO DELETE. Nothing references story_price_tiers by foreign key
-- (checked), and story_purchases snapshots its own seconds/price_paise at
-- purchase time, so every historical receipt still reads correctly with these
-- rows gone.
--
-- Mirrored by src/lib/storyPricing.ts (PRICE_TIERS),
-- src/lib/storyCostModel.ts (MOVIE_TIERS), src/lib/storyPlan.ts
-- (MIN_STORY_SECONDS) and the studio's PRESETS, pinned together by test.

delete from public.story_price_tiers where seconds < 60;

-- THE COPY THAT ACTUALLY BINDS. claim_story_seconds clamps the request to
-- story_config.min_story_seconds, so leaving this at 10 would let a caller
-- claim a 30s film straight past a checkout that no longer sells one.
update public.story_config
   set min_story_seconds = 60,
       updated_at = now()
 where id = true;

-- And the DEFAULT, not just the live row: a project seeded from scratch after
-- today must not come up selling a duration that was withdrawn for margin.
alter table public.story_config
  alter column min_story_seconds set default 60;

comment on column public.story_config.min_story_seconds is
  'Shortest Story that may be claimed, seconds. 60 since 2026-08-15: a flat per-film cost cannot be recovered by a per-minute price, so sub-minute films could not clear the 26% margin floor and were withdrawn rather than priced off the rate line.';