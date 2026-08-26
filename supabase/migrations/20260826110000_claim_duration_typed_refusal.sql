-- Typed duration-estimate refusal payload on the claim gate.
--
-- Context (measured, 2026-08-26): story job 76d09a89 requested 300s of
-- verbatim narration from 381 words. The estimate — words / 2.5 wps =
-- 152.4s, fill 0.508 — passed this gate's floor by 2.4 seconds; the real
-- voice spoke at 2.672 wps and measured 142.6s (47.5%), so the film died
-- at the authoritative post-PREPARE gate with 43 stills and 43 voice
-- clips already paid for. Speech rate measured across four real films
-- spans 1.86-2.67 words/second (English prose to romanized Hindi), so
-- the PREDICTIVE gate can never hold that boundary; the worker now
-- speaks and measures ALL voices before the first still (voices-first,
-- owner directive 2026-08-26) and re-checks the band on the measurement.
--
-- This migration does NOT move any band. It only makes this gate's
-- refusal typed and self-describing — code, estimate, bounds, word count
-- — so the client can show "requested / estimated / required" without
-- re-deriving the arithmetic. The function body is otherwise identical
-- to 20260820145330 (FREE FOR ALL).

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

  -- FREE FOR ALL: this branch was `if is_admin(me)`. Every authenticated user
  -- now rides the free path; counters are read but never written.
  insert into story_jobs (user_id, prompt, requested_seconds, seconds_charged,
    paid_seconds_charged, no_watermark, grade, verbatim)
  values (me, prompt_clean, wanted, 0, 0, true, grade_clean, coalesce(_verbatim, false))
  returning id into job_id;
  return jsonb_build_object('ok', true, 'jobId', job_id, 'seconds', wanted,
    'remaining', period_left, 'dailyLeft', daily_left, 'paidSeconds', a_paid,
    'plan', plan_key, 'admin', is_admin(me), 'free', true);
end;
$function$;
