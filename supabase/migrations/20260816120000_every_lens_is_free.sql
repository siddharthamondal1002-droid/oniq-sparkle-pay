-- EVERY LENS IS FREE — owner directive, 2026-08-16 (evening).
--
-- The rack was split three-free / twelve-Plus that morning
-- (20260816060000_monthly_plans.sql gave `all_lenses` to the paid tiers only)
-- and the owner reversed it the same day. No lens is gated now, on any plan.
--
-- WHY THE ENTITLEMENT STAYS, AND WHY IT GOES ON *EVERY* PLAN RATHER THAN
-- MOVING TO THE FREE ROW. Same reasoning as group_calls on 2026-08-16:
-- has_entitlement resolves against the CURRENT plan, so moving `all_lenses`
-- to `free` alone would answer FALSE for a paying subscriber and take the
-- lenses away from whoever pays the most. Present on all four plans means
-- everybody holds it, whatever they are on.
--
-- The client no longer reads it for gating at all — the lock, the padlock
-- badge and the upsell toast are deleted from both surfaces, and
-- faceFx.test.ts fails if any of them come back. What the entitlement is FOR
-- now is the plan sheet, which names it on the Free card, and the option to
-- re-gate later as a change to this table rather than to the app.

update public.subscription_plans
   set entitlements = array(select distinct unnest(entitlements || array['all_lenses']))
 where key in ('free', 'plus_monthly', 'plus_25', 'plus_60');
