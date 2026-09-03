-- Story films in a language other than English.
--
-- OWNER DIRECTIVE, 2026-09-03: a film in a language other than English is
-- voiced by the CLOUD voice (Gemini TTS through the Lovable gateway); English
-- films stay on the in-house engine. Every in-house voice ONIQ owns is an
-- English model, and there is no Piper voice for any Indian language, so the
-- only honest alternative to the cloud voice was no such film at all.
--
-- The language is a property of the JOB, chosen in the studio, validated by
-- claim_story_seconds and by this CHECK constraint against the SAME set: the
-- languages the cloud voice documents as supported, intersected with the
-- translator's list — not the translator's full 22. story-callback hands it to
-- the worker at claim; the worker sends it to story-plot (narration and
-- dialogue in the language, image prompts in English) and picks the engine.
--
-- The function is DROPPED and recreated rather than overloaded: a second
-- signature next to the old one leaves PostgREST unable to choose between them
-- for a call that omits the new argument, and every installed build omits it.

alter table public.story_jobs
  add column if not exists language text not null default 'en';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'story_jobs_language_check'
  ) then
    alter table public.story_jobs
      add constraint story_jobs_language_check
      check (language in ('en', 'hi', 'bn', 'mr', 'ta', 'te'));
  end if;
end $$;

comment on column public.story_jobs.language is
  'Owner directive 2026-09-03: the film''s narration and dialogue language. '
  'en = in-house voice; anything else = the cloud voice, because no in-house '
  'voice exists for it. Same set as claim_story_seconds and the studio picker.';

drop function if exists public.claim_story_seconds(integer, text, text, boolean);

CREATE OR REPLACE FUNCTION public.claim_story_seconds(_requested_seconds integer, _prompt text, _grade text DEFAULT 'movie'::text, _verbatim boolean DEFAULT false, _language text DEFAULT 'en'::text)
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
  lang_clean text;
begin
  if me is null then raise exception 'not authenticated'; end if;
  grade_clean := case when _grade = 'movie' then 'movie' else null end;
  if grade_clean is null then raise exception 'no such grade'; end if;
  -- THE FILM'S LANGUAGE (owner directive, 2026-09-03). Validated here against
  -- the same set the column's CHECK constraint carries: the languages a voice
  -- exists for, not the translator's 22. Anything else is refused, never
  -- silently mapped to English.
  lang_clean := lower(trim(coalesce(_language, 'en')));
  if lang_clean not in ('en', 'hi', 'bn', 'mr', 'ta', 'te') then raise exception 'no such language'; end if;
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
    paid_seconds_charged, no_watermark, grade, verbatim, motion_mode, language)
  values (me, prompt_clean, wanted, 0, 0, true, grade_clean, coalesce(_verbatim, false), motion, lang_clean)
  returning id into job_id;
  return jsonb_build_object('ok', true, 'jobId', job_id, 'seconds', wanted,
    'remaining', period_left, 'dailyLeft', daily_left, 'paidSeconds', a_paid,
    'plan', plan_key, 'admin', is_admin(me), 'free', true, 'motion', motion is not null,
    'language', lang_clean);
end;
$function$;

revoke all on function public.claim_story_seconds(integer, text, text, boolean, text) from public, anon;
grant execute on function public.claim_story_seconds(integer, text, text, boolean, text) to authenticated;
