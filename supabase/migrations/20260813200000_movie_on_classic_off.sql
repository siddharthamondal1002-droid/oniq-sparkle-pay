-- Movie ON, classic OFF — the owner's launch flip (directive, 2026-08-13:
-- "Make classic inactive for now and make movie active").
--
-- UNLIKE EVERY PRICING MIGRATION BEFORE IT, this one DOES set `active` on
-- conflict — deliberately, because flipping what is on sale IS this
-- migration's whole purpose, not a side effect of a reprice. Prices are
-- unchanged from 20260813190000 (the in-house chart at the mandated margins).
--
-- The movie grade this sells is the IN-HOUSE ENGINE: the owned stack of
-- depth parallax, rigged speaking characters, phoneme lip-sync, dialogue
-- voices and the film look, rendered by ONIQ's own worker. The rented clip
-- stage stays in the code as an owner-only experiment behind STORY_MOVIE=on;
-- it is not what this tier buys, which is why the claim below drops the
-- movie gates the rented stage needed (admin-only, and the 120-second clamp
-- that guarded a runner clock the in-house render does not have).

insert into public.story_price_tiers (seconds, label, price_paise, sort_order, grade, active) values
  (30,  '30 seconds',         2700,  1,  'classic', false),
  (60,  '1 minute',           4800,  2,  'classic', false),
  (120, '2 minutes',          9200,  3,  'classic', false),
  (180, '3 minutes',          12600, 4,  'classic', false),
  (300, '5 minutes',          20800, 5,  'classic', false),
  (30,  '30 seconds — movie', 3100,  6,  'movie',   true),
  (60,  '1 minute — movie',   5700,  7,  'movie',   true),
  (120, '2 minutes — movie',  10900, 8,  'movie',   true),
  (180, '3 minutes — movie',  15000, 9,  'movie',   true),
  (300, '5 minutes — movie',  24700, 10, 'movie',   true)
on conflict (seconds, grade) do update
  set label = excluded.label,
      price_paise = excluded.price_paise,
      sort_order = excluded.sort_order,
      active = excluded.active,
      updated_at = now();

-- The claim, with the movie gates removed: any user may claim a movie film,
-- clamped by the same config bounds as classic. Everything else is verbatim
-- from 20260813060000, and storyJobsSchema.test.ts parses THIS file as the
-- newest definition.
drop function if exists public.claim_story_seconds(int, text, text);

create or replace function public.claim_story_seconds(
  _requested_seconds int,
  _prompt text,
  _grade text default 'classic'
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

  grade_clean := case when _grade in ('classic', 'movie') then _grade else null end;
  if grade_clean is null then raise exception 'no such grade'; end if;

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
                            paid_seconds_charged, no_watermark, grade)
    values (me, prompt_clean, wanted, 0, 0, true, grade_clean)
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
                          paid_seconds_charged, grade)
  values (me, prompt_clean, wanted, wanted, spend_paid, grade_clean)
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

revoke all on function public.claim_story_seconds(int, text, text) from public, anon;
grant execute on function public.claim_story_seconds(int, text, text) to authenticated;
