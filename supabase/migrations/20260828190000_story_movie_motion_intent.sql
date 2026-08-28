-- A Story Movie asks for motion, so the claim that creates it says so.
--
-- OWNER DIRECTIVE 2026-08-28: a normal, user-facing Story Movie generation
-- must reach ONIQ's own LTX motion engine without anyone editing a database
-- row by hand first.
--
-- WHAT WAS ACTUALLY BROKEN. story_jobs.motion_mode landed 2026-08-22 for a
-- one-off Veo `select` validation, and claim_story_seconds was never taught
-- to set it — the INSERT below simply did not list the column, so every
-- production job took the NULL default. story-dispatch then sent no
-- story_movie flag, the workflow resolved STORY_MOVIE to '', the worker set
-- clipStage='off', and generateClip() was never called. Measured on job
-- e377f793 (2026-08-28): the route resolved correctly to the in-house engine
-- and the film still came back nine shots of stills, five of which had asked
-- for motion.
--
-- Two gates, and they are not the same gate. IN_HOUSE_MOTION chooses WHICH
-- engine animates a shot. This one decides WHETHER the clip stage runs at
-- all. Turning the first on says nothing about the second.
--
-- WHY 'select' AND NOT 'on'. 'select' is the spend-guarded variant: the
-- worker's motion-runtime contract attempts a clip ONLY for shots whose own
-- grammar calls for character motion and which no measured rig already
-- serves. Every other shot stays on the free still/parallax path. That IS
-- "correctly determine when a Story Movie requires motion" — the judgement
-- lives in the shot grammar, per shot, not in a blanket flag. 'on' — attempt
-- a clip for every shot — stays unreachable from data, exactly as before.
--
-- WHAT DID NOT CHANGE, deliberately:
--   * The client cannot influence this. The function signature is untouched,
--     so there is no new parameter; the value is derived server-side from the
--     grade the claim itself validated and from story_config. A browser still
--     cannot choose GPU, provider, model, endpoint, budget or runtime.
--   * story_jobs still carries no INSERT or UPDATE policy, so motion_mode
--     remains writable by the service role alone.
--   * The CHECK constraint still admits only NULL or 'select'.
--   * Every guard around the spend — admission, budget, one-job-at-a-time,
--     watchdog, orphan sweep, R2 — is untouched.
--
-- THE KILL SWITCH. story_config.motion_select turns this off without a
-- deploy, the way story_config.enabled and video_gen_config.enabled already
-- do for their own stages. It defaults ON because the directive above asks
-- for the next ordinary generation to animate; set it false and every job
-- returns to still-only immediately, with no code change and nothing to
-- redeploy.

alter table public.story_config
  add column if not exists motion_select boolean not null default true;

comment on column public.story_config.motion_select is
  'Owner kill switch: when true, claim_story_seconds stamps movie-grade jobs '
  'with motion_mode=select so the clip stage runs for shots whose grammar '
  'calls for motion. False returns every Story to still-only, no deploy.';

CREATE OR REPLACE FUNCTION public.claim_story_seconds(_requested_seconds integer, _prompt text, _grade text DEFAULT 'movie'::text, _verbatim boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me uuid := auth.uid();
  cfg public.story_config%rowtype;
  today date := (now() at time zone 'utc')::date;
  prompt_clean text; grade_clean text; wanted int; spoken_seconds numeric;
  word_count int;
  global_used int; plan_key text; plan_included int; is_free_plan boolean;
  a_paid int; a_daily_used int; a_daily_day date; a_period_start date; a_period_used int;
  period_now date; period_left int; daily_left int;
  spend_included int; spend_paid int; free_spend int; clean boolean; job_id uuid;
  motion text;
begin
  if me is null then raise exception 'not authenticated'; end if;
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

  wanted := greatest(cfg.min_story_seconds, least(cfg.max_story_seconds, coalesce(_requested_seconds, 0)));

  if coalesce(_verbatim, false) then
    word_count := (select count(*)::int
        from regexp_split_to_table(translate(prompt_clean, chr(160), ' '), '\s+') w
       where w <> '');
    spoken_seconds := word_count / 2.5;
    if wanted > 600 then
      return jsonb_build_object('ok', false, 'reason', 'verbatim-fit',
        'code', 'story-duration-estimate-out-of-band',
        'spokenSeconds', round(spoken_seconds),
        'estimatedSeconds', round(spoken_seconds),
        'requestedSeconds', wanted, 'wordCount', word_count,
        'lowerBound', 0, 'upperBound', 600,
        'remaining', 0, 'dailyLeft', 0, 'paidSeconds', 0, 'wanted', wanted);
    end if;
    if spoken_seconds < wanted * 0.5 or spoken_seconds > wanted * 1.25 then
      return jsonb_build_object('ok', false, 'reason', 'verbatim-fit',
        'code', 'story-duration-estimate-out-of-band',
        'spokenSeconds', round(spoken_seconds),
        'estimatedSeconds', round(spoken_seconds),
        'requestedSeconds', wanted, 'wordCount', word_count,
        'lowerBound', round(wanted * 0.5), 'upperBound', round(wanted * 1.25),
        'remaining', 0, 'dailyLeft', 0, 'paidSeconds', 0, 'wanted', wanted);
    end if;
  end if;

  insert into story_global_usage (day) values (today) on conflict (day) do nothing;
  select used_seconds into global_used from story_global_usage where day = today for update;

  plan_key := my_plan_key(me);
  period_now := allowance_period_start(me);
  select included_seconds into plan_included from subscription_plans where key = plan_key;
  plan_included := coalesce(plan_included, 0);
  is_free_plan := (plan_key = 'free');

  insert into story_allowance (user_id) values (me) on conflict (user_id) do nothing;
  select paid_seconds, daily_used_seconds, daily_day, period_start, period_used_seconds
    into a_paid, a_daily_used, a_daily_day, a_period_start, a_period_used
    from story_allowance where user_id = me for update;

  if a_period_start is distinct from period_now then a_period_used := 0; end if;
  if a_daily_day is distinct from today then a_daily_used := 0; end if;

  period_left := greatest(0, plan_included - coalesce(a_period_used, 0));
  daily_left := case when is_free_plan then greatest(0, cfg.daily_seconds - a_daily_used) else period_left end;
  clean := has_entitlement(me, 'no_watermark');

  -- THE STORY MOVIE'S MOTION INTENT, decided here and nowhere else. The grade
  -- was validated above from the request; the switch is owner configuration.
  -- No client value reaches this, and 'select' is the only value the column's
  -- CHECK constraint will accept besides NULL.
  motion := case when coalesce(cfg.motion_select, false) and grade_clean = 'movie'
                 then 'select' else null end;

  -- FREE FOR ALL: this branch was `if is_admin(me)`. Every authenticated user
  -- now rides the free path; counters are read but never written.
  insert into story_jobs (user_id, prompt, requested_seconds, seconds_charged,
    paid_seconds_charged, no_watermark, grade, verbatim, motion_mode)
  values (me, prompt_clean, wanted, 0, 0, true, grade_clean, coalesce(_verbatim, false), motion)
  returning id into job_id;
  return jsonb_build_object('ok', true, 'jobId', job_id, 'seconds', wanted,
    'remaining', period_left, 'dailyLeft', daily_left, 'paidSeconds', a_paid,
    'plan', plan_key, 'admin', is_admin(me), 'free', true, 'motion', motion is not null);
end;
$function$;
