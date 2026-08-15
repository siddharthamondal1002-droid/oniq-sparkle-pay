-- CLASSIC IS WITHDRAWN. Owner directive, 2026-08-15: "make classic inactive
-- totally."
--
-- The 2026-08-13 flip set every classic row `active = false`, which stopped
-- classic being SOLD. It did not stop classic being MADE, and those are
-- different doors: `claim_story_seconds` defaults `_grade` to 'classic' and
-- the studio only names a grade when the user switched movie on, so the
-- default path built the withdrawn product. 31 of the 44 films in story_jobs
-- are classic and the most recent was 10:32 this morning — two hours before
-- this migration. "Inactive" was true of the price list and false of the
-- factory.
--
-- WHAT THIS CLOSES, in the order a request meets them:
--
--   1. story_jobs.grade defaults to 'movie', so a row that somehow arrives
--      without a grade is a film we still sell.
--   2. claim_story_seconds defaults to 'movie' and REFUSES 'classic'. Safe to
--      refuse rather than coerce because no client has ever sent 'classic'
--      explicitly — the studio omits the parameter for classic and names it
--      only for movie — so every already-installed build lands on the new
--      default instead of an error.
--   3. create_story_purchase does the same, which as a side effect repairs
--      checkout: razorpay-order calls it without a grade, so the 'classic'
--      default sent it looking for an active classic tier, found none, and
--      returned 'no-such-tier'. Story time has been unbuyable since 13 August.
--   4. A CHECK makes an active classic row impossible, so this cannot be
--      undone by an UPDATE that looked harmless.
--
-- WHAT IT DELIBERATELY DOES NOT DO. The classic rows stay in
-- story_price_tiers and the 31 classic jobs keep their grade. Reviving classic
-- is `alter table ... drop constraint story_price_tiers_classic_withdrawn`
-- plus two function defaults — one commit, not a reconstruction. Deleting the
-- rows would buy nothing and lose the price history.

-- 1. The column default. Belt to the function's braces: an insert that reaches
--    story_jobs by any other path still gets the product that is on sale.
alter table public.story_jobs alter column grade set default 'movie';

comment on column public.story_jobs.grade is
  'Which pipeline builds the film. ''movie'' since 2026-08-15 — classic was withdrawn (owner directive) and is refused at claim time; historical rows keep ''classic'' so their films still read correctly.';

-- 2. The claim. Verbatim from the live definition except the grade lines: the
--    default moves to 'movie' and 'classic' is no longer an accepted value.
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
  -- The client shows the same arithmetic before the button; this is the
  -- copy that cannot be bypassed.
  --
  -- The count MIRRORS JS split(/\s+/).filter(Boolean) exactly, which took
  -- three deliberate moves the review panel forced: empty tokens filtered
  -- (Postgres trim() strips only spaces, so leading newlines survive and
  -- would count), NBSP translated to space (JS \s matches it, Postgres'
  -- does not), and a ceiling past which no story the box can hold could
  -- reach the tier's floor — now 600s, the platform maximum, rather than
  -- 180s, because a 5000-character box can hold ~333s of speech.
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

-- 3. The purchase. Same grade change, and it is the line that puts Story time
--    back on sale: razorpay-order sends no grade at all, so the old 'classic'
--    default made every checkout look up a tier that had been off sale since
--    13 August and return 'no-such-tier'.
create or replace function public.create_story_purchase(
  _seconds int,
  _origin text default 'web',
  _grade text default 'movie'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  tier public.story_price_tiers%rowtype;
  cfg public.story_purchase_config%rowtype;
  new_id uuid;
  origin_clean text;
  grade_clean text;
begin
  if me is null then raise exception 'not authenticated'; end if;

  select * into cfg from story_purchase_config where id = true;
  if not found or not cfg.enabled then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;

  grade_clean := case when _grade = 'movie' then 'movie' else null end;
  if grade_clean is null then
    return jsonb_build_object('ok', false, 'reason', 'no-such-grade');
  end if;

  -- STILL PRICED FROM THE TABLE, never from the request. The grade narrows
  -- which row is read; it never supplies an amount.
  select * into tier
    from story_price_tiers
   where seconds = _seconds and grade = grade_clean and active;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no-such-tier');
  end if;

  origin_clean := case when _origin = 'native-handoff' then 'native-handoff' else 'web' end;

  insert into story_purchases (user_id, seconds, price_paise, currency, origin, grade)
  values (me, tier.seconds, tier.price_paise, tier.currency, origin_clean, grade_clean)
  returning id into new_id;

  return jsonb_build_object(
    'ok', true,
    'purchaseId', new_id,
    'seconds', tier.seconds,
    'label', tier.label,
    'amountMinor', tier.price_paise,
    'currency', tier.currency,
    'grade', grade_clean
  );
end;
$$;

revoke all on function public.create_story_purchase(int, text, text) from public, anon;
grant execute on function public.create_story_purchase(int, text, text) to authenticated;

-- 4. The rule the data itself carries. `active = false` on every classic row
--    is a fact about today; this is the statement that it stays true. Without
--    it, "classic is withdrawn" lives only in two function bodies and one
--    UPDATE puts a withdrawn product back on the shelf.
update public.story_price_tiers set active = false where grade = 'classic' and active;

alter table public.story_price_tiers
  drop constraint if exists story_price_tiers_classic_withdrawn;
alter table public.story_price_tiers
  add constraint story_price_tiers_classic_withdrawn
  check (grade <> 'classic' or active = false);

comment on constraint story_price_tiers_classic_withdrawn on public.story_price_tiers is
  'Classic cannot go back on sale by UPDATE (owner directive, 2026-08-15: withdrawn totally). Reviving it is a deliberate migration that drops this constraint, which is the point.';
