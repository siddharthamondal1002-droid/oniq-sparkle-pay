-- The voice-budget ledger: Supabase as the TTS quota's bookkeeper.
--
-- 2026-08-12: seven proof runs emptied Gemini TTS's DAILY quota mid-evening.
-- The failure mode was the expensive one — films DISPATCHED, drew all their
-- stills (real image spend), and then died at the voice stage with nothing
-- to show. No retry fixes an empty daily bucket; the fix is to never start
-- a film the day's remaining voice budget cannot finish.
--
-- Supabase cannot generate voices, but it can count them. story-voice
-- records every successful TTS call here; story-dispatch reads what is left
-- and leaves a job QUEUED — waiting, not failed — when the budget is short.
-- The job dispatches automatically once the bucket rolls over.
--
-- THE DAY IS PACIFIC, not UTC, because that is when Google actually resets
-- the quota (midnight America/Los_Angeles). A UTC ledger would tell the
-- dispatcher the bucket refilled seven hours before it really did.

create table if not exists public.api_budget (
  day date not null,
  bucket text not null,
  used integer not null default 0,
  primary key (day, bucket)
);

-- Service-role territory only. RLS on with no policies: nothing a user
-- token can read or write, so a client cannot inflate the ledger and starve
-- everyone's dispatches.
alter table public.api_budget enable row level security;

/** The quota day: today where Google's reset clock lives. */
create or replace function public.api_budget_day()
returns date
language sql stable
set search_path = public
as $$
  select (now() at time zone 'America/Los_Angeles')::date;
$$;

/** Record spend. Called by edge functions with the service role after a
 *  successful billable call — recording, not gating, so a wrong cap
 *  constant can never block a call that would actually have worked. */
create or replace function public.record_api_use(_bucket text, _amount integer)
returns void
language sql security definer
set search_path = public
as $$
  insert into public.api_budget (day, bucket, used)
  values (public.api_budget_day(), _bucket, greatest(_amount, 0))
  on conflict (day, bucket)
  do update set used = public.api_budget.used + greatest(_amount, 0);
$$;

/** What is left of today's bucket against a caller-supplied cap. The cap
 *  lives in the caller (story-dispatch), next to the estimate that uses it,
 *  so tuning it after a billing-tier change touches one file. */
create or replace function public.api_budget_left(_bucket text, _cap integer)
returns integer
language sql stable security definer
set search_path = public
as $$
  select _cap - coalesce(
    (select used from public.api_budget
      where day = public.api_budget_day() and bucket = _bucket),
    0
  );
$$;

-- Only the service role may touch the ledger. Without these revokes any
-- authenticated user could call record_api_use through PostgREST and
-- convince the dispatcher the day's budget is spent.
revoke all on function public.record_api_use(text, integer) from public, anon, authenticated;
revoke all on function public.api_budget_left(text, integer) from public, anon, authenticated;
revoke all on function public.api_budget_day() from public, anon, authenticated;