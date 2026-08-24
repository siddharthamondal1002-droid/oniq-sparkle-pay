-- CENTRAL PROVIDER SPEND LEDGER — one accounting system, many capabilities.
--
-- WHY THIS REPLACES search_spend_*. The search guard (20260824050000) got the
-- SHAPE right — reserve, call, measure, settle, fail closed — and then video
-- needed the same thing, and text, and images, and TTS. Four copies of
-- check-then-spend is four places for the check to drift out of step with the
-- spend, and the whole point of the row lock is that there is exactly ONE
-- place where "is there budget" and "take the budget" happen together.
--
-- So: one ledger, one lock, one settlement rule. What DIFFERS per capability is
-- the UNIT and the PRICE, and those live in the edge-function adapters where
-- they can be read next to the call that uses them. Nothing here converts a
-- video second into a token; the ledger only ever adds up dollars.
--
--   FINANCIAL_ADMISSION → CAPABILITY → PROVIDER → MODEL → UNIT
--     → RESERVATION → PROVIDER CALL → MEASURED SETTLEMENT
--
-- THREE CEILINGS, not one. A day cap alone cannot stop one pathological film
-- eating the day, and neither can stop a single shot retrying forever:
--   request  — one provider call
--   job      — one film / one shot ladder (bounded retries live here)
--   day      — the whole fleet
--
-- FAIL CLOSED EVERYWHERE. No config row, `enabled = false`, no price, no
-- ledger: admission is REFUSED. `enabled` DEFAULTS TO FALSE, which is the
-- owner's `generation_allowed=false` expressed as a schema default rather than
-- as a flag someone has to remember to set.

-- ------------------------------------------------------------------ config
create table if not exists public.provider_budget_config (
  -- One row per capability. Video's ceilings are not search's ceilings and
  -- pretending otherwise is how one capability's runaway drains another's.
  capability      text primary key
                    check (capability in
                      ('SEARCH', 'TEXT', 'IMAGE', 'VIDEO', 'VIDEO_AUDIO', 'TTS', 'OTHER')),
  -- Deliberately NO DEFAULTS on the money. What ONIQ is willing to spend is an
  -- owner decision; a default here would be inventing one.
  daily_usd_cap   numeric(10, 4) not null,
  request_usd_cap numeric(10, 4) not null,
  job_usd_cap     numeric(10, 4) not null,
  -- Bounded retries (§17). A failed 8-second shot must never regenerate
  -- forever, and "forever" is what an absent ceiling means.
  max_attempts_per_job integer   not null default 3 check (max_attempts_per_job > 0),
  -- OFF until the owner turns it on. This is generation_allowed=false.
  enabled         boolean        not null default false,
  updated_at      timestamptz    not null default now()
);

comment on table public.provider_budget_config is
  'Per-capability spend ceilings. No row, or enabled=false, means admission is '
  'refused for that capability (fail closed). enabled defaults to FALSE.';

-- ------------------------------------------------------------------ ledger
create table if not exists public.provider_spend_ledger (
  id              uuid primary key default gen_random_uuid(),
  day             date        not null default (now() at time zone 'utc')::date,
  request_id      text        not null,
  -- The film, the story job, the shot ladder — whatever the retry budget is
  -- scoped to. Null for one-shot work like a search query.
  job_id          text,
  capability      text        not null,
  provider        text        not null,
  model           text        not null,
  -- What is being counted. NEVER normalised into a single number: a video
  -- second and an input token are not convertible and a ledger that pretends
  -- they are will misprice both.
  unit            text        not null,
  units_reserved  numeric(14, 4) not null,
  units_actual    numeric(14, 4),
  estimated_usd   numeric(12, 6) not null,
  -- Null means the provider did not tell us what it charged. It stays null;
  -- the ESTIMATE is what gets charged. Never back-filled with 0.
  actual_usd      numeric(12, 6),
  state           text        not null default 'RESERVED'
                    check (state in ('RESERVED', 'SETTLED', 'RELEASED')),
  -- Did the product keep the output? Separate from whether the provider
  -- succeeded: a clip that generates perfectly and fails motion QA is a
  -- provider success and a product rejection, and the user is charged for
  -- neither.
  outcome         text        check (outcome in
                    ('ACCEPTED', 'REJECTED', 'FAILED', 'FILTERED', 'NOT_CALLED')),
  -- Capability-specific measurements. jsonb because a video row records
  -- audio mode and motion adherence while a search row records hop counts,
  -- and forcing both into shared columns would flatten what makes each useful.
  detail          jsonb,
  attempt         integer     not null default 1,
  user_id         uuid,
  created_at      timestamptz not null default now(),
  settled_at      timestamptz
);

create unique index if not exists provider_spend_ledger_request_uk
  on public.provider_spend_ledger (request_id);
create index if not exists provider_spend_ledger_day_cap_idx
  on public.provider_spend_ledger (day, capability, state);
create index if not exists provider_spend_ledger_job_idx
  on public.provider_spend_ledger (job_id) where job_id is not null;

comment on table public.provider_spend_ledger is
  'One row per admitted provider call, any capability. RESERVED on admission, '
  'SETTLED on reconcile, RELEASED only when the provider was never called.';

-- ------------------------------------------------------------------ rollups
create table if not exists public.provider_spend_day (
  day            date    not null,
  capability     text    not null,
  reserved_usd   numeric(14, 6) not null default 0,
  settled_usd    numeric(14, 6) not null default 0,
  request_count  integer not null default 0,
  primary key (day, capability)
);

create table if not exists public.provider_spend_job (
  job_id         text primary key,
  capability     text    not null,
  reserved_usd   numeric(14, 6) not null default 0,
  settled_usd    numeric(14, 6) not null default 0,
  attempts       integer not null default 0,
  created_at     timestamptz not null default now()
);

comment on table public.provider_spend_job is
  'Per-job spend and attempt count. This is what makes a retry ladder bounded: '
  'a shot that keeps failing runs out of attempts, not out of patience.';

alter table public.provider_budget_config enable row level security;
alter table public.provider_spend_ledger  enable row level security;
alter table public.provider_spend_day     enable row level security;
alter table public.provider_spend_job     enable row level security;

-- No policies. These are reachable only through the SECURITY DEFINER functions
-- below; a client must never read the ceiling or write the ledger.
revoke all on public.provider_budget_config from anon, authenticated;
revoke all on public.provider_spend_ledger  from anon, authenticated;
revoke all on public.provider_spend_day     from anon, authenticated;
revoke all on public.provider_spend_job     from anon, authenticated;

-- ------------------------------------------------------------------ admit
--
-- ATOMIC ADMISSION across three ceilings. Locks the day row (and the job row
-- when there is one), checks request/job/day, reserves, commits. Two concurrent
-- workers cannot both read the same remaining budget and both spend it.
create or replace function public.admit_provider_spend(
  _request_id    text,
  _capability    text,
  _provider      text,
  _model         text,
  _unit          text,
  _units         numeric,
  _estimated_usd numeric,
  _job_id        text default null,
  _user_id       uuid default null,
  _detail        jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg       public.provider_budget_config%rowtype;
  today     date := (now() at time zone 'utc')::date;
  day_row   public.provider_spend_day%rowtype;
  job_row   public.provider_spend_job%rowtype;
  committed numeric;
  remaining numeric;
  job_committed numeric;
  attempt_no integer := 1;
begin
  if _estimated_usd is null or _estimated_usd < 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid-estimate');
  end if;
  -- A zero reservation is how an unpriced call sneaks through on a
  -- technicality. There is no such thing as a free provider call here.
  if _estimated_usd = 0 then
    return jsonb_build_object('ok', false, 'reason', 'zero-estimate');
  end if;
  if _model is null or _model = '' then
    return jsonb_build_object('ok', false, 'reason', 'no-model');
  end if;

  select * into cfg from public.provider_budget_config where capability = _capability;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no-budget-configured',
      'capability', _capability);
  end if;
  if not cfg.enabled then
    -- generation_allowed = false
    return jsonb_build_object('ok', false, 'reason', 'capability-disabled',
      'capability', _capability);
  end if;
  if _estimated_usd > cfg.request_usd_cap then
    return jsonb_build_object('ok', false, 'reason', 'over-request-cap',
      'requestCapUsd', cfg.request_usd_cap, 'estimatedUsd', _estimated_usd);
  end if;

  -- Idempotent. A replayed request_id never reserves twice.
  if exists (select 1 from public.provider_spend_ledger where request_id = _request_id) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate-request');
  end if;

  -- ---- job ceiling: bounded retries and bounded per-film spend -----------
  if _job_id is not null then
    insert into public.provider_spend_job (job_id, capability)
      values (_job_id, _capability) on conflict (job_id) do nothing;
    select * into job_row from public.provider_spend_job where job_id = _job_id for update;

    if job_row.capability <> _capability then
      return jsonb_build_object('ok', false, 'reason', 'job-capability-mismatch');
    end if;
    if job_row.attempts >= cfg.max_attempts_per_job then
      return jsonb_build_object('ok', false, 'reason', 'job-attempts-exhausted',
        'attempts', job_row.attempts, 'maxAttempts', cfg.max_attempts_per_job);
    end if;
    job_committed := job_row.reserved_usd + job_row.settled_usd;
    if _estimated_usd > cfg.job_usd_cap - job_committed then
      return jsonb_build_object('ok', false, 'reason', 'job-cap-reached',
        'jobCapUsd', cfg.job_usd_cap, 'jobCommittedUsd', job_committed);
    end if;
    attempt_no := job_row.attempts + 1;
  end if;

  -- ---- day ceiling -------------------------------------------------------
  insert into public.provider_spend_day (day, capability) values (today, _capability)
    on conflict (day, capability) do nothing;
  select * into day_row from public.provider_spend_day
    where day = today and capability = _capability for update;

  -- Reserved counts against the cap as if spent. Optimism here is exactly how
  -- concurrent workers overspend.
  committed := day_row.reserved_usd + day_row.settled_usd;
  remaining := cfg.daily_usd_cap - committed;
  if _estimated_usd > remaining then
    return jsonb_build_object('ok', false, 'reason', 'daily-cap-reached',
      'remainingUsd', greatest(remaining, 0), 'dailyCapUsd', cfg.daily_usd_cap);
  end if;

  insert into public.provider_spend_ledger
    (request_id, job_id, capability, provider, model, unit, units_reserved,
     estimated_usd, state, attempt, user_id, detail)
  values
    (_request_id, _job_id, _capability, _provider, _model, _unit, _units,
     _estimated_usd, 'RESERVED', attempt_no, _user_id, _detail);

  update public.provider_spend_day
     set reserved_usd = reserved_usd + _estimated_usd,
         request_count = request_count + 1
   where day = today and capability = _capability;

  if _job_id is not null then
    update public.provider_spend_job
       set reserved_usd = reserved_usd + _estimated_usd,
           attempts = attempts + 1
     where job_id = _job_id;
  end if;

  return jsonb_build_object('ok', true, 'reason', 'admitted',
    'attempt', attempt_no,
    'remainingUsd', remaining - _estimated_usd,
    'dailyCapUsd', cfg.daily_usd_cap,
    'requestCapUsd', cfg.request_usd_cap,
    'jobCapUsd', cfg.job_usd_cap,
    'maxAttemptsPerJob', cfg.max_attempts_per_job);
end;
$$;

-- ------------------------------------------------------------------ settle
--
-- Reconcile against what actually happened. `_actual_usd` null means the
-- provider did not report a cost: the ESTIMATE stands as the charge rather than
-- being silently zeroed. Never fabricate a refund.
--
-- `_outcome` records whether the PRODUCT kept the output. It does not change
-- what ONIQ pays — a rejected clip was still generated and still billed — and
-- it is what the customer-billing side reads to decide the user owes nothing.
create or replace function public.settle_provider_spend(
  _request_id  text,
  _actual_usd  numeric default null,
  _units_actual numeric default null,
  _outcome     text default null,
  _detail      jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  led    public.provider_spend_ledger%rowtype;
  charge numeric;
begin
  select * into led from public.provider_spend_ledger
   where request_id = _request_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown-request');
  end if;
  if led.state <> 'RESERVED' then
    return jsonb_build_object('ok', false, 'reason', 'already-' || lower(led.state));
  end if;

  charge := coalesce(_actual_usd, led.estimated_usd);

  update public.provider_spend_ledger
     set actual_usd   = _actual_usd,
         units_actual = _units_actual,
         outcome      = coalesce(_outcome, outcome),
         detail       = coalesce(_detail, detail),
         state        = 'SETTLED',
         settled_at   = now()
   where request_id = _request_id;

  update public.provider_spend_day
     set reserved_usd = greatest(reserved_usd - led.estimated_usd, 0),
         settled_usd  = settled_usd + charge
   where day = led.day and capability = led.capability;

  if led.job_id is not null then
    update public.provider_spend_job
       set reserved_usd = greatest(reserved_usd - led.estimated_usd, 0),
           settled_usd  = settled_usd + charge
     where job_id = led.job_id;
  end if;

  return jsonb_build_object('ok', true, 'reason', 'settled', 'chargedUsd', charge,
    'actualKnown', _actual_usd is not null);
end;
$$;

-- ------------------------------------------------------------------ release
--
-- ONLY for the case where the provider was never called. Releasing after a
-- provider call would be inventing a refund. The attempt is NOT given back:
-- a call that never left the box still consumed a slot in the ladder, and
-- handing it back is how a bounded retry becomes an unbounded one.
create or replace function public.release_provider_spend(_request_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  led public.provider_spend_ledger%rowtype;
begin
  select * into led from public.provider_spend_ledger
   where request_id = _request_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown-request');
  end if;
  if led.state <> 'RESERVED' then
    return jsonb_build_object('ok', false, 'reason', 'already-' || lower(led.state));
  end if;

  update public.provider_spend_ledger
     set state = 'RELEASED', outcome = 'NOT_CALLED', settled_at = now()
   where request_id = _request_id;

  update public.provider_spend_day
     set reserved_usd = greatest(reserved_usd - led.estimated_usd, 0)
   where day = led.day and capability = led.capability;

  if led.job_id is not null then
    update public.provider_spend_job
       set reserved_usd = greatest(reserved_usd - led.estimated_usd, 0)
     where job_id = led.job_id;
  end if;

  return jsonb_build_object('ok', true, 'reason', 'released');
end;
$$;

-- ------------------------------------------------------------------ outcome
--
-- ACCEPTANCE ARRIVES AFTER SETTLEMENT, and that is not a design flaw.
--
-- A clip is billed when the provider finishes generating it. Whether the
-- PRODUCT keeps it is decided later, by technical QA, then motion/prompt QA,
-- then audio QA — in the worker, minutes afterwards. Forcing acceptance into
-- settle_provider_spend would mean either holding the reservation open until QA
-- finishes (so a crashed worker leaves budget stuck) or guessing at settle time.
--
-- So: settle records what the PROVIDER did and what it cost. This records what
-- ONIQ did with it, and it is the only reason `usd_per_accepted_unit` can be a
-- real number rather than a hopeful one. It never touches money.
create or replace function public.record_provider_outcome(
  _request_id text,
  _outcome    text,
  _detail     jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  led public.provider_spend_ledger%rowtype;
begin
  if _outcome is null or _outcome not in ('ACCEPTED', 'REJECTED', 'FAILED', 'FILTERED') then
    return jsonb_build_object('ok', false, 'reason', 'invalid-outcome');
  end if;
  select * into led from public.provider_spend_ledger
   where request_id = _request_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown-request');
  end if;
  -- A released row was never called, so there is nothing to accept or reject.
  if led.state = 'RELEASED' then
    return jsonb_build_object('ok', false, 'reason', 'already-released');
  end if;

  update public.provider_spend_ledger
     set outcome = _outcome,
         detail  = case when _detail is null then detail else coalesce(detail, '{}'::jsonb) || _detail end
   where request_id = _request_id;

  return jsonb_build_object('ok', true, 'reason', 'recorded', 'outcome', _outcome);
end;
$$;

-- ------------------------------------------------------------------ metrics
create or replace view public.provider_spend_daily_metrics as
select
  l.day,
  l.capability,
  l.provider,
  l.model,
  l.unit,
  count(*)                                              as requests,
  count(*) filter (where l.state = 'SETTLED')           as settled,
  count(*) filter (where l.state = 'RELEASED')          as released,
  count(*) filter (where l.state = 'RESERVED')          as still_reserved,
  count(*) filter (where l.outcome = 'ACCEPTED')        as accepted,
  count(*) filter (where l.outcome = 'REJECTED')        as rejected,
  count(*) filter (where l.outcome = 'FAILED')          as failed,
  count(*) filter (where l.outcome = 'FILTERED')        as filtered,
  -- Unknown cost falls back to the estimate, the same rule settlement applies.
  sum(coalesce(l.actual_usd, l.estimated_usd))          as charged_usd,
  count(*) filter (where l.actual_usd is null and l.state = 'SETTLED')
                                                        as settled_without_known_cost,
  sum(coalesce(l.units_actual, l.units_reserved))       as units,
  -- THE NUMBER THE WHOLE ROUTING DECISION RESTS ON: what a KEPT unit costs,
  -- not what a generated one costs. Null until something is accepted, because
  -- dividing by zero acceptances would invent a figure.
  case when sum(coalesce(l.units_actual, 0)) filter (where l.outcome = 'ACCEPTED') > 0
       then sum(coalesce(l.actual_usd, l.estimated_usd))
            / sum(coalesce(l.units_actual, 0)) filter (where l.outcome = 'ACCEPTED')
       end                                              as usd_per_accepted_unit,
  avg(l.attempt::numeric)                               as avg_attempts
from public.provider_spend_ledger l
group by l.day, l.capability, l.provider, l.model, l.unit;

comment on view public.provider_spend_daily_metrics is
  'Per day/capability/provider/model: spend, acceptance mix, and USD per '
  'ACCEPTED unit. Service role only.';

revoke all on public.provider_spend_daily_metrics from anon, authenticated;

-- ------------------------------------------------------------------ carry over
--
-- The search ledger (20260824050000) is superseded by the tables above. It
-- never carried production rows — no budget row was ever configured, so
-- admission refused everything — but copying first and dropping second is the
-- order that stays correct if that assumption is wrong.
do $$
begin
  if to_regclass('public.search_spend_ledger') is not null then
    insert into public.provider_spend_ledger
      (day, request_id, capability, provider, model, unit, units_reserved,
       estimated_usd, actual_usd, state, user_id, detail, created_at, settled_at)
    select
      s.day, s.request_id, 'SEARCH', s.provider, coalesce(s.model, 'unknown'),
      'search+tokens', coalesce(s.search_count, 0), s.estimated_usd, s.actual_usd,
      s.state, s.user_id,
      jsonb_strip_nulls(jsonb_build_object(
        'searchType', s.search_type, 'searchCount', s.search_count,
        'llmCalls', s.llm_calls, 'inputTokens', s.input_tokens,
        'outputTokens', s.output_tokens, 'cacheHits', s.cache_hits,
        'terminationReason', s.termination_reason)),
      s.created_at, s.settled_at
    from public.search_spend_ledger s
    on conflict (request_id) do nothing;

    insert into public.provider_spend_day (day, capability, reserved_usd, settled_usd, request_count)
    select d.day, 'SEARCH', d.reserved_usd, d.settled_usd, d.request_count
    from public.search_spend_day d
    on conflict (day, capability) do nothing;
  end if;
end $$;

drop view if exists public.search_spend_daily_metrics;
drop view if exists public.search_termination_mix;
drop function if exists public.admit_search_spend(text, numeric, text, text, text, uuid);
drop function if exists public.settle_search_spend(text, numeric, integer, integer, integer, integer, integer, text);
drop function if exists public.release_search_spend(text);
drop table if exists public.search_spend_ledger;
drop table if exists public.search_spend_day;
drop table if exists public.search_budget_config;

-- Service role only. A client must never admit its own spend.
revoke all on function public.admit_provider_spend(text, text, text, text, text, numeric, numeric, text, uuid, jsonb)
  from anon, authenticated;
revoke all on function public.settle_provider_spend(text, numeric, numeric, text, jsonb)
  from anon, authenticated;
revoke all on function public.release_provider_spend(text) from anon, authenticated;
revoke all on function public.record_provider_outcome(text, text, jsonb) from anon, authenticated;
