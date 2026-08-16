-- THE CLAIM, AND THE STATUS, ON A MONTHLY ALLOWANCE.
--
-- 20260816060000 added the plans; this moves the two functions that actually
-- gate and report onto them. Everything the old versions refused, these
-- refuse for the same reasons and with the same reason codes — the grade
-- check, the 5000-character prompt cap, the verbatim fit band, the global
-- capacity guard, the owner's free ride. Only the allowance arithmetic
-- changed, from "300 seconds, once, for life" to "N seconds per period".
--
-- THREE THINGS CHANGED SHAPE, each deliberate:
--
-- 1. THE DAILY CAP NOW APPLIES TO THE FREE PLAN ONLY. It exists to stop one
--    account draining the giveaway in an afternoon. Applied to a subscriber
--    it would be a second, tighter quota inside the one they bought: 120
--    seconds a day against 480 a month means their eighth minute arrives on
--    day four. Selling somebody 8 minutes and then rationing it is not what
--    was sold.
--
-- 2. THE GLOBAL DAILY CEILING NOW COUNTS FREE SPEND ONLY. It is a giveaway
--    guard, and it already ignored prepaid seconds for that reason. Left
--    counting subscriber minutes too, eight Plus members could exhaust it
--    and then block each other out of film they had paid for — a paying
--    customer refused with 'capacity' because other paying customers got
--    there first.
--
-- 3. no_watermark IS NOW AN ENTITLEMENT rather than an admin flag. Plus
--    includes it, so it is read from the plan at claim time. This is the
--    first thing entitlements actually do.

create or replace function public.claim_story_seconds(
  _requested_seconds int,
  _prompt text,
  _grade text default 'movie',
  _verbatim boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg public.story_config%rowtype;
  today date := (now() at time zone 'utc')::date;
  prompt_clean text;
  grade_clean text;
  wanted int;
  spoken_seconds numeric;
  global_used int;
  plan_key text;
  plan_included int;
  is_free_plan boolean;
  a_paid int;
  a_daily_used int;
  a_daily_day date;
  a_period_start date;
  a_period_used int;
  period_now date;
  period_left int;
  daily_left int;
  spend_included int;
  spend_paid int;
  free_spend int;
  clean boolean;
  job_id uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;

  -- ONE GRADE. 'classic' is not a value any more, not a value that is
  -- quietly rewritten: a caller that asks for the withdrawn product should
  -- be told, not handed something else and charged for it.
  grade_clean := case when _grade = 'movie' then 'movie' else null end;
  if grade_clean is null then raise exception 'no such grade'; end if;

  prompt_clean := trim(coalesce(_prompt, ''));
  if length(prompt_clean) = 0 then raise exception 'prompt required'; end if;
  if length(prompt_clean) > 5000 then raise exception 'prompt too long'; end if;

  select * into cfg from story_config where id = true;
  if not found then raise exception 'story config missing'; end if;

  if not cfg.enabled then
    return jsonb_build_object('ok', false, 'reason', 'disabled',
                              'remaining', 0, 'dailyLeft', 0, 'paidSeconds', 0, 'wanted', 0);
  end if;

  wanted := greatest(cfg.min_story_seconds,
                     least(cfg.max_story_seconds, coalesce(_requested_seconds, 0)));

  -- THE VERBATIM FIT BAND. Words / 2.5 wps, against [0.5x, 1.25x] of the
  -- purchase. Refused BEFORE any debit — a story that cannot honestly fill
  -- (or would silently exceed) the bought seconds never spends anything.
  --
  -- The count MIRRORS JS split(/\s+/).filter(Boolean) exactly: empty tokens
  -- filtered, NBSP translated to a space (JS \s matches it, Postgres' does
  -- not), and a 600s ceiling past which no story the box can hold could
  -- reach the floor.
  if coalesce(_verbatim, false) then
    if wanted > 600 then
      return jsonb_build_object('ok', false, 'reason', 'verbatim-fit',
                                'spokenSeconds', 0,
                                'remaining', 0, 'dailyLeft', 0, 'paidSeconds', 0,
                                'wanted', wanted);
    end if;
    spoken_seconds :=
      (select count(*)::numeric
         from regexp_split_to_table(translate(prompt_clean, chr(160), ' '), '\s+') w
        where w <> '') / 2.5;
    if spoken_seconds < wanted * 0.5 or spoken_seconds > wanted * 1.25 then
      return jsonb_build_object('ok', false, 'reason', 'verbatim-fit',
                                'spokenSeconds', round(spoken_seconds),
                                'remaining', 0, 'dailyLeft', 0, 'paidSeconds', 0,
                                'wanted', wanted);
    end if;
  end if;

  insert into story_global_usage (day) values (today) on conflict (day) do nothing;
  select used_seconds into global_used from story_global_usage where day = today for update;

  -- The plan, and what it grants per period.
  plan_key := my_plan_key(me);
  period_now := allowance_period_start(me);
  select included_seconds into plan_included from subscription_plans where key = plan_key;
  plan_included := coalesce(plan_included, 0);
  is_free_plan := (plan_key = 'free');

  insert into story_allowance (user_id) values (me) on conflict (user_id) do nothing;
  select paid_seconds, daily_used_seconds, daily_day, period_start, period_used_seconds
    into a_paid, a_daily_used, a_daily_day, a_period_start, a_period_used
    from story_allowance where user_id = me for update;

  -- A NEW PERIOD ZEROES THE COUNTER, IN MEMORY FIRST. The row is only written
  -- on a successful claim below, so a refused attempt cannot silently reset
  -- somebody's month.
  if a_period_start is distinct from period_now then
    a_period_used := 0;
  end if;
  if a_daily_day is distinct from today then
    a_daily_used := 0;
  end if;

  period_left := greatest(0, plan_included - coalesce(a_period_used, 0));
  -- Free plan only; see the header. A subscriber's daily room is their month.
  daily_left := case when is_free_plan
                     then greatest(0, cfg.daily_seconds - a_daily_used)
                     else period_left end;

  clean := has_entitlement(me, 'no_watermark');

  -- THE OWNER RIDES FREE. Nothing is debited anywhere; the job is created
  -- pre-charged at zero and pre-clean. Sits AFTER the reads so the reply
  -- carries real numbers, and BEFORE every refusal because none of them
  -- apply to an account that spends nothing.
  if is_admin(me) then
    insert into story_jobs (user_id, prompt, requested_seconds, seconds_charged,
                            paid_seconds_charged, no_watermark, grade, verbatim)
    values (me, prompt_clean, wanted, 0, 0, true, grade_clean, coalesce(_verbatim, false))
    returning id into job_id;
    return jsonb_build_object(
      'ok', true, 'jobId', job_id, 'seconds', wanted,
      'remaining', period_left, 'dailyLeft', daily_left, 'paidSeconds', a_paid,
      'plan', plan_key, 'admin', true
    );
  end if;

  spend_included := least(wanted, period_left, daily_left);
  spend_paid := least(wanted - spend_included, a_paid);

  if spend_included + spend_paid < wanted then
    if period_left <= 0 and a_paid <= 0 then
      return jsonb_build_object('ok', false, 'reason', 'exhausted',
                                'remaining', period_left, 'dailyLeft', daily_left,
                                'paidSeconds', a_paid, 'plan', plan_key, 'wanted', wanted);
    end if;
    if spend_included < least(wanted, period_left) then
      return jsonb_build_object('ok', false, 'reason', 'daily',
                                'remaining', period_left, 'dailyLeft', daily_left,
                                'paidSeconds', a_paid, 'plan', plan_key, 'wanted', wanted);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'too-long',
                              'remaining', period_left, 'dailyLeft', daily_left,
                              'paidSeconds', a_paid, 'plan', plan_key, 'wanted', wanted);
  end if;

  -- Only the giveaway counts against the shared ceiling; see the header.
  free_spend := case when is_free_plan then spend_included else 0 end;

  if global_used + free_spend > cfg.global_daily_seconds then
    return jsonb_build_object('ok', false, 'reason', 'capacity',
                              'remaining', period_left, 'dailyLeft', daily_left,
                              'paidSeconds', a_paid, 'plan', plan_key, 'wanted', wanted);
  end if;

  update story_global_usage
     set used_seconds = used_seconds + free_spend,
         paid_seconds = paid_seconds + spend_paid + (spend_included - free_spend),
         updated_at = now()
   where day = today;

  update story_allowance
     set used_seconds = used_seconds + spend_included,
         paid_seconds = paid_seconds - spend_paid,
         period_start = period_now,
         period_used_seconds = a_period_used + spend_included,
         daily_used_seconds = a_daily_used + spend_included,
         daily_day = today,
         updated_at = now()
   where user_id = me;

  insert into story_jobs (user_id, prompt, requested_seconds, seconds_charged,
                          paid_seconds_charged, no_watermark, grade, verbatim)
  values (me, prompt_clean, wanted, spend_included, spend_paid, clean, grade_clean,
          coalesce(_verbatim, false))
  returning id into job_id;

  return jsonb_build_object(
    'ok', true, 'jobId', job_id, 'seconds', wanted,
    'remaining', greatest(0, period_left - spend_included),
    'dailyLeft', greatest(0, daily_left - spend_included),
    'paidSeconds', a_paid - spend_paid,
    'plan', plan_key
  );
end;
$$;

revoke all on function public.claim_story_seconds(int, text, text, boolean) from public, anon;
grant execute on function public.claim_story_seconds(int, text, text, boolean) to authenticated;

-- ------------------------------------------------------------------ status

-- The client reads this before showing the studio. The pre-monthly keys —
-- remaining / dailyLeft / paidSeconds / freeSeconds — are all still here and
-- all still mean something, so a client that has not been redeployed keeps
-- working while it catches up. The plan fields are additions.
create or replace function public.story_quota_status()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg public.story_config%rowtype;
  pcfg public.story_purchase_config%rowtype;
  today date := (now() at time zone 'utc')::date;
  plan public.subscription_plans%rowtype;
  sub public.subscriptions%rowtype;
  plan_key text;
  period_now date;
  a_paid int;
  a_daily_used int;
  a_daily_day date;
  a_period_start date;
  a_period_used int;
  period_left int;
  daily_left int;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into cfg from story_config where id = true;
  if not found then raise exception 'story config missing'; end if;
  select * into pcfg from story_purchase_config where id = true;

  if is_admin(me) then
    return jsonb_build_object(
      'enabled', cfg.enabled,
      'freeSeconds', cfg.max_story_seconds,
      'usedSeconds', 0,
      'remaining', cfg.max_story_seconds,
      'dailyLeft', cfg.max_story_seconds,
      'paidSeconds', 0,
      'minSeconds', cfg.min_story_seconds,
      'maxSeconds', cfg.max_story_seconds,
      'purchaseEnabled', false,
      'nativeLinkOut', false,
      'checkoutUrl', pcfg.checkout_url,
      'plan', 'admin', 'planLabel', 'Owner', 'includedSeconds', cfg.max_story_seconds,
      'noWatermark', true,
      'admin', true
    );
  end if;

  plan_key := my_plan_key(me);
  period_now := allowance_period_start(me);
  select * into plan from subscription_plans where key = plan_key;
  select * into sub from subscriptions where user_id = me;

  select paid_seconds, daily_used_seconds, daily_day, period_start, period_used_seconds
    into a_paid, a_daily_used, a_daily_day, a_period_start, a_period_used
    from story_allowance where user_id = me;

  if not found then
    a_paid := 0; a_daily_used := 0; a_daily_day := today;
    a_period_start := null; a_period_used := 0;
  end if;
  if a_period_start is distinct from period_now then a_period_used := 0; end if;
  if a_daily_day is distinct from today then a_daily_used := 0; end if;

  period_left := greatest(0, coalesce(plan.included_seconds, 0) - coalesce(a_period_used, 0));
  daily_left := case when plan_key = 'free'
                     then greatest(0, cfg.daily_seconds - a_daily_used)
                     else period_left end;

  return jsonb_build_object(
    'enabled', cfg.enabled,
    'freeSeconds', coalesce(plan.included_seconds, 0),
    'usedSeconds', coalesce(a_period_used, 0),
    'remaining', period_left,
    'dailyLeft', daily_left,
    'paidSeconds', coalesce(a_paid, 0),
    'minSeconds', cfg.min_story_seconds,
    'maxSeconds', cfg.max_story_seconds,
    'purchaseEnabled', coalesce(pcfg.enabled, false),
    'nativeLinkOut', coalesce(pcfg.native_link_out, false),
    'checkoutUrl', pcfg.checkout_url,
    -- the plan half
    'plan', plan_key,
    'planLabel', coalesce(plan.label, 'Free'),
    'includedSeconds', coalesce(plan.included_seconds, 0),
    'periodStart', period_now,
    'renewsOn', sub.period_end,
    'cancelAtPeriodEnd', coalesce(sub.cancel_at_period_end, false),
    'subStatus', coalesce(sub.status, 'none'),
    'noWatermark', has_entitlement(me, 'no_watermark'),
    'allLenses', has_entitlement(me, 'all_lenses')
  );
end;
$$;

revoke all on function public.story_quota_status() from public, anon;
grant execute on function public.story_quota_status() to authenticated;
