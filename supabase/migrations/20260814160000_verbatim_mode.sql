-- VERBATIM MODE — the user's words, narrated exactly as written.
--
-- Owner directive, 2026-08-14: an explicit "My words" toggle next to the
-- movie switch. When on, Ting does not retell the supplied story — the
-- worker slices the user's own text into shot narrations and Ting writes
-- only what prose cannot supply (stills, cast locks, shot sizes).
--
-- THE PRICING GUARD LIVES HERE, in the claim, not only in the client.
-- Narration is the film's clock: a five-hundred-word story on a
-- sixty-second purchase would render three and a half minutes of film for
-- sixty seconds of money. A verbatim claim is therefore refused unless the
-- text's estimated speech fits a band around the purchase — half to
-- five-quarters of the seconds bought, at ~2.5 spoken words a second.
-- Mirrored by src/lib/verbatimNarration.ts and pinned together by test.

alter table public.story_jobs
  add column if not exists verbatim boolean not null default false;

drop function if exists public.claim_story_seconds(int, text, text);

create or replace function public.claim_story_seconds(
  _requested_seconds int,
  _prompt text,
  _grade text default 'classic',
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

  -- THE VERBATIM FIT BAND. Words / 2.5 wps, against [0.5x, 1.25x] of the
  -- purchase. Refused BEFORE any debit — a story that cannot honestly fill
  -- (or would silently exceed) the bought seconds never spends anything.
  -- The client shows the same arithmetic before the button; this is the
  -- copy that cannot be bypassed.
  --
  -- The count MIRRORS JS split(/\s+/).filter(Boolean) exactly, which took
  -- three deliberate moves the review panel forced: empty tokens filtered
  -- (Postgres trim() strips only spaces, so leading newlines survive and
  -- would count), NBSP translated to space (JS \s matches it, Postgres'
  -- does not), and the 300s tier refused outright — the 2000-char prompt
  -- cap cannot hold 150s of speech, so the band could never pass there
  -- and the toggle must say so instead of asking for the impossible.
  if coalesce(_verbatim, false) then
    if wanted > 180 then
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
                            paid_seconds_charged, no_watermark, grade, verbatim)
    values (me, prompt_clean, wanted, 0, 0, true, grade_clean, coalesce(_verbatim, false))
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
                          paid_seconds_charged, grade, verbatim)
  values (me, prompt_clean, wanted, wanted, spend_paid, grade_clean,
          coalesce(_verbatim, false))
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

revoke all on function public.claim_story_seconds(int, text, text, boolean) from public, anon;
grant execute on function public.claim_story_seconds(int, text, text, boolean) to authenticated;
