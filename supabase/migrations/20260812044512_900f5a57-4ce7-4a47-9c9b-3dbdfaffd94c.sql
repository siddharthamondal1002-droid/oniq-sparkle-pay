-- ============================================================================
-- THE OWNER RIDES FREE — every paid in-app feature costs an admin nothing.
--
-- OWNER DIRECTIVE (2026-08-12): "All in app paid features are free to use
-- for siddharthamondal1002@gmail.com as the id is admin and owner of app".
-- Keyed on is_admin(), not on an email: the flag already marks that account,
-- and a second admin added later inherits the same standing.
--
-- WHAT THIS REPLACES. claim_story_seconds and story_quota_status, verbatim
-- from their paid-seconds versions (20260810115624), each gaining one early
-- admin branch. The refusal order, the ceiling arithmetic, and the absence
-- of user-facing copy are all pinned by storyJobsSchema.test.ts, which now
-- parses THIS file as the newest definition.
--
-- WHAT AN ADMIN CLAIM DOES NOT TOUCH: the global day ceiling, the personal
-- day, the lifetime allowance, purchased seconds. Counters are read (for the
-- honest numbers in the reply) but never written, so paying users' meters
-- are unaffected. The length clamp still applies — free is not unbounded.
-- The job is created with seconds_charged = 0 (the refund path already
-- treats a zero charge as nothing-to-return) and no_watermark = true,
-- because the watermark addon is a paid feature too.
-- ============================================================================
create or replace function public.claim_story_seconds(_requested_seconds int, _prompt text)
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
  wanted int;
  global_used int;
  a_free int;
  a_used int;
  a_paid int;
  a_daily_used int;
  a_daily_day date;
  free_cap int;
  remaining int;
  daily_left int;
  spend_free int;
  spend_paid int;
  job_id uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;

  prompt_clean := trim(coalesce(_prompt, ''));
  if length(prompt_clean) = 0 then raise exception 'prompt required'; end if;
  if length(prompt_clean) > 2000 then raise exception 'prompt too long'; end if;

  select * into cfg from story_config where id = true;
  if not found then raise exception 'story config missing'; end if;

  if not cfg.enabled then
    return jsonb_build_object('ok', false, 'reason', 'disabled',
                              'remaining', 0, 'dailyLeft', 0, 'paidSeconds', 0, 'wanted', 0);
  end if;

  wanted := greatest(cfg.min_story_seconds,
                     least(cfg.max_story_seconds, coalesce(_requested_seconds, 0)));

  insert into story_global_usage (day) values (today) on conflict (day) do nothing;
  select used_seconds into global_used from story_global_usage where day = today for update;

  insert into story_allowance (user_id) values (me) on conflict (user_id) do nothing;
  select free_seconds, used_seconds, paid_seconds, daily_used_seconds, daily_day
    into a_free, a_used, a_paid, a_daily_used, a_daily_day
    from story_allowance where user_id = me for update;

  if a_daily_day <> today then
    a_daily_used := 0;
  end if;

  free_cap := coalesce(a_free, cfg.free_seconds);
  remaining := greatest(0, free_cap - a_used);
  daily_left := greatest(0, cfg.daily_seconds - a_daily_used);

  -- THE OWNER RIDES FREE. Nothing is debited anywhere; the job is created
  -- pre-charged at zero and pre-clean. Sits AFTER the reads so the reply
  -- carries real numbers, and BEFORE every refusal because none of them
  -- apply to an account that spends nothing.
  if is_admin(me) then
    insert into story_jobs (user_id, prompt, requested_seconds, seconds_charged,
                            paid_seconds_charged, no_watermark)
    values (me, prompt_clean, wanted, 0, 0, true)
    returning id into job_id;
    return jsonb_build_object(
      'ok', true,
      'jobId', job_id,
      'seconds', wanted,
      'remaining', remaining,
      'dailyLeft', daily_left,
      'paidSeconds', a_paid,
      'admin', true
    );
  end if;

  -- How this request splits across the two buckets. Free is taken first, and is
  -- itself bounded by what is left of today; the remainder comes out of what
  -- was paid for.
  spend_free := least(wanted, remaining, daily_left);
  spend_paid := least(wanted - spend_free, a_paid);

  if spend_free + spend_paid < wanted then
    if remaining <= 0 and a_paid <= 0 then
      return jsonb_build_object('ok', false, 'reason', 'exhausted',
                                'remaining', remaining, 'dailyLeft', daily_left,
                                'paidSeconds', a_paid, 'wanted', wanted);
    end if;
    if spend_free < least(wanted, remaining) then
      return jsonb_build_object('ok', false, 'reason', 'daily',
                                'remaining', remaining, 'dailyLeft', daily_left,
                                'paidSeconds', a_paid, 'wanted', wanted);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'too-long',
                              'remaining', remaining, 'dailyLeft', daily_left,
                              'paidSeconds', a_paid, 'wanted', wanted);
  end if;

  -- The ceiling applies to the free portion only. A request funded entirely
  -- out of purchased seconds passes even on a day that is otherwise spent.
  if global_used + spend_free > cfg.global_daily_seconds then
    return jsonb_build_object('ok', false, 'reason', 'capacity',
                              'remaining', remaining, 'dailyLeft', daily_left,
                              'paidSeconds', a_paid, 'wanted', wanted);
  end if;

  update story_global_usage
     set used_seconds = used_seconds + spend_free,
         paid_seconds = paid_seconds + spend_paid,
         updated_at = now()
   where day = today;

  update story_allowance
     set used_seconds = used_seconds + spend_free,
         paid_seconds = paid_seconds - spend_paid,
         daily_used_seconds = a_daily_used + spend_free,
         daily_day = today,
         updated_at = now()
   where user_id = me;

  insert into story_jobs (user_id, prompt, requested_seconds, seconds_charged,
                          paid_seconds_charged)
  values (me, prompt_clean, wanted, wanted, spend_paid)
  returning id into job_id;

  return jsonb_build_object(
    'ok', true,
    'jobId', job_id,
    'seconds', wanted,
    'remaining', remaining - spend_free,
    'dailyLeft', daily_left - spend_free,
    'paidSeconds', a_paid - spend_paid
  );
end;
$$;

revoke all on function public.claim_story_seconds(int, text) from public, anon;
grant execute on function public.claim_story_seconds(int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- story_quota_status — the admin sees no meter and nothing for sale. The
-- reply shape is unchanged; the numbers say "enough for the longest film,
-- always", and purchaseEnabled false keeps every buy button out of the way.
-- ---------------------------------------------------------------------------
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
  a_free int;
  a_used int;
  a_paid int;
  a_daily_used int;
  a_daily_day date;
  free_cap int;
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
      'admin', true
    );
  end if;

  select free_seconds, used_seconds, paid_seconds, daily_used_seconds, daily_day
    into a_free, a_used, a_paid, a_daily_used, a_daily_day
    from story_allowance where user_id = me;

  if not found then
    a_free := null; a_used := 0; a_paid := 0; a_daily_used := 0; a_daily_day := today;
  end if;
  if a_daily_day <> today then a_daily_used := 0; end if;

  free_cap := coalesce(a_free, cfg.free_seconds);

  return jsonb_build_object(
    'enabled', cfg.enabled,
    'freeSeconds', free_cap,
    'usedSeconds', a_used,
    'remaining', greatest(0, free_cap - a_used),
    'dailyLeft', greatest(0, cfg.daily_seconds - a_daily_used),
    'paidSeconds', coalesce(a_paid, 0),
    'minSeconds', cfg.min_story_seconds,
    'maxSeconds', cfg.max_story_seconds,
    'purchaseEnabled', coalesce(pcfg.enabled, false),
    'nativeLinkOut', coalesce(pcfg.native_link_out, false),
    'checkoutUrl', pcfg.checkout_url
  );
end;
$$;

revoke all on function public.story_quota_status() from public, anon;
grant execute on function public.story_quota_status() to authenticated;