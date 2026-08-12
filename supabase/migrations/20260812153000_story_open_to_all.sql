-- ============================================================================
-- THE MOVIE MAKER OPENS. Owner directive, 2026-08-12: "surface the movie
-- maker to all".
--
-- `story_config.enabled` has shipped FALSE since 2026-08-09, and the reason
-- was honest: app AI drew on the same credit balance that builds ONIQ, and no
-- per-Story cost had been measured, so the screen was finished and the switch
-- was off. Both halves of that reason are now answered — storyCostModel.ts
-- derives cost per grade from named unit costs, and the published price tiers
-- recover it at the mandated margins (28% short / 26% mid / 21% long).
--
-- WHAT THIS COSTS, at today's caps and today's pipeline (stills + narration
-- under Ken Burns; the per-second video stage is not wired, so its $0.15/s
-- does not apply yet):
--
--   generation      ~₹31 per finished minute
--   global ceiling   3600 seconds/day across ALL users  = 60 minutes
--   worst case       ~₹1,871/day, if every free second at the cap is used
--
-- The ceiling is the thing that makes this safe to switch on, and it is a
-- config row: lower `global_daily_seconds` and the exposure drops the same
-- day, with no deploy. Per-person limits are unchanged — 300 free seconds
-- lifetime, 120 a day — so "free" stays a taste and length stays the thing
-- money buys.
--
-- This flips ONE boolean. It does not touch limits, prices or quotas.
-- ============================================================================
update public.story_config
   set enabled = true,
       updated_at = now()
 where id = true;
