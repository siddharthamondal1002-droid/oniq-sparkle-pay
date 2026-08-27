-- Video entitlement gets its own authority — the story policy stays put.
--
-- Owner directive 2026-08-27 (continuation loop, Phase 5). The first real
-- production generation (job e010372d) surfaced the collision this file
-- resolves: `has_entitlement` has been `select true` for everyone since the
-- story product's deliberate free-for-all (2026-08-20, migration 64cb23b2:
-- "FREE FOR ALL: was is_admin(_user) or plan entitlements"), and the video
-- catalogue (2026-08-27) had wired its watermark entitlement to that same
-- function — so every video job recorded no_watermark = true and the
-- marked/clean product split did not exist in practice.
--
-- The fix is scoped, per the owner's stated architecture:
--
--   story entitlement  -> has_entitlement        (free-for-all, UNTOUCHED)
--   video entitlement  -> has_video_entitlement  (this file)
--                           1. owner/admin rides free (2026-08-12 directive)
--                           2. else the CURRENT plan must be a VIDEO plan
--                              (video_included_seconds > 0) carrying the key
--
-- The video-plan requirement is the load-bearing line: the legacy story
-- Plus plans (plus_25/plus_60/plus_monthly, still active) carry
-- 'no_watermark' for the STORY product, and bare plan-entitlement matching
-- would hand their subscribers clean VIDEO clips priced far under Pro.
-- video_included_seconds is already the catalogue's isolation marker
-- (story plans hold 0), so story perks cannot leak into video and video
-- perks cannot leak into story. PAYG Clean (₹49/min) is deliberately NOT
-- representable here yet: video_purchases has no clean flag, so clean PAYG
-- is not sellable until that purchase path is built — fail closed.

create or replace function public.has_video_entitlement(_user uuid, _key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_admin(_user) or exists (
    select 1 from subscription_plans p
     where p.key = my_plan_key(_user)
       and p.video_included_seconds > 0
       and _key = any(p.entitlements)
  );
$$;

revoke all on function public.has_video_entitlement(uuid, text) from public, anon;
grant execute on function public.has_video_entitlement(uuid, text) to authenticated;

-- video_time_status's watermarkFree display follows the same authority the
-- submit path reads, so the panel can never promise a product the export
-- layer would refuse. Body identical to 20260827200000 except that one call.
create or replace function public.video_time_status()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg public.video_sale_config%rowtype;
  acct public.video_time_accounts%rowtype;
  pk text;
  vinc bigint;
  pstart date;
  period_used bigint;
  live_reserved bigint;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into cfg from video_sale_config where id = true;

  if is_admin(me) then
    return jsonb_build_object(
      'admin', true, 'unlimited', true,
      'salesEnabled', coalesce(cfg.sales_enabled, false),
      'trialEnabled', coalesce(cfg.trial_enabled, true),
      'watermarkFree', true
    );
  end if;

  select * into acct from video_time_accounts where user_id = me;
  if not found then
    acct.trial_ms_granted := 60000; acct.trial_ms_used := 0;
    acct.period_start := null; acct.period_used_ms := 0; acct.paid_ms := 0;
  end if;

  pk := my_plan_key(me);
  select video_included_seconds::bigint * 1000 into vinc
    from subscription_plans where key = pk;
  vinc := coalesce(vinc, 0);
  pstart := allowance_period_start(me);
  period_used := case when acct.period_start is distinct from pstart
                      then 0 else acct.period_used_ms end;

  select coalesce(sum(reserved_trial_ms + reserved_plan_ms + reserved_paid_ms), 0)
    into live_reserved
    from video_time_reservations
   where user_id = me and status = 'reserved';

  return jsonb_build_object(
    'salesEnabled', coalesce(cfg.sales_enabled, false),
    'trialEnabled', coalesce(cfg.trial_enabled, true),
    'trialRemainingMs', case when coalesce(cfg.trial_enabled, true)
      then greatest(0, acct.trial_ms_granted - acct.trial_ms_used) else 0 end,
    'plan', pk,
    'planIncludedMs', vinc,
    'planRemainingMs', greatest(0, vinc - period_used),
    'paidMs', acct.paid_ms,
    'reservedMs', live_reserved,
    'watermarkFree', has_video_entitlement(me, 'no_watermark')
  );
end;
$$;

revoke all on function public.video_time_status() from public, anon;
grant execute on function public.video_time_status() to authenticated;
