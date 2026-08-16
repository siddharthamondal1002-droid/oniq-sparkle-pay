-- GROUP CALLS ARE FREE FOR EVERYONE (owner directive, 2026-08-16).
--
-- They shipped inside the Plus bundle a few hours earlier, alongside the
-- watermark and the lens rack. Withdrawn from the paid-only set because a
-- group call costs ONIQ nothing per use and gating it makes the product worse
-- for the people who have not paid yet — which is currently everybody.
--
-- IT STAYS ON EVERY PLAN ROW RATHER THAN MOVING TO THE FREE ONE.
-- `has_entitlement` resolves against the CURRENT plan only, so removing
-- group_calls from Plus while adding it to Free would take group calls away
-- from the subscribers paying the most — the exact opposite of the intent.
-- Present on all four plans means everybody holds it, whatever they are on.
--
-- The consequence is a display problem rather than a permission one: a benefit
-- every plan carries would otherwise pad every paid card with something nobody
-- is paying for. PlanSheet handles that by listing, on a paid card, only what
-- Free does not already give — "Everything in Free, plus …".
update public.subscription_plans
   set entitlements = array(select distinct unnest(entitlements || '{group_calls}'::text[]))
 where key in ('free', 'plus_monthly', 'plus_25', 'plus_60');
