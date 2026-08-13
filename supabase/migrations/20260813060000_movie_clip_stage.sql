-- ============================================================================
-- THE MOVIE GRADE REACHES THE JOB ROW — the clip stage's database half.
--
-- The movie-grade chart has existed since 20260811165731, priced against Veo
-- at $0.15/s and left INACTIVE "until the clip stage ships". The stage is
-- shipping now, so the worker needs to know which pipeline a job bought — and
-- the only honest place for that is the row, because the runner is handed a
-- receipt, not a request body it could be lied to through.
--
-- WHAT THIS ADDS:
--   - story_jobs.grade ('classic' | 'movie'), defaulted so every existing row
--     and every old caller keeps meaning what it meant.
--   - claim_story_seconds gains _grade. The old two-argument function is
--     DROPPED first — an overload pair with a defaulted third argument is
--     ambiguous to PostgREST, which would answer both shapes with an error.
--
-- MOVIE IS NOT ON SALE YET. The movie tiers stay inactive and a non-admin
-- asking for movie grade is REFUSED by exception, exactly like a malformed
-- prompt — because purchased seconds are one grade-blind bucket today, and
-- letting a classic-priced second fund a Veo render would invert the margin
-- policy this chart was derived from. Opening it to everyone is the follow-up
-- migration that splits the paid bucket by grade; until then the owner (who
-- rides free) proves the pipeline.
--
-- MOVIE IS CLAMPED TO 120 SECONDS for now, below the classic ceiling. A movie
-- minute is ~8.5 sequential Veo generations at minutes each; at 120s the whole
-- job fits the runner's clock with room, and the ceiling lifts when a long
-- film has actually been timed rather than estimated.
--
-- Everything else — refusal order, lock order, the free/paid split, the owner
-- branch — is verbatim from 20260812044512 (owner rides free), and
-- storyJobsSchema.test.ts parses THIS file as the newest definition.
-- ============================================================================
alter table public.story_jobs
  add column if not exists grade text not null default 'classic'
    check (grade in ('classic', 'movie'));

drop function if exists public.claim_story_seconds(int, text);

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

  -- Movie grade is admin-only until the paid bucket learns grades. An
  -- exception rather than a reason payload: the studio only shows the toggle
  -- to admins, so reaching this is a hand-written call, not a user journey.
  if grade_clean = 'movie' and not is_admin(me) then
    raise exception 'movie grade is not open yet';
  end if;

  wanted := greatest(cfg.min_story_seconds,
                     least(cfg.max_story_seconds, coalesce(_requested_seconds, 0)));

  -- The movie ceiling: ~8.5 sequential Veo generations per finished minute,
  -- each taking minutes, against a 90-minute runner clock. Lifts when a long
  -- movie film has been TIMED end to end, not before.
  if grade_clean = 'movie' then
    wanted := least(wanted, 120);
  end if;

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
