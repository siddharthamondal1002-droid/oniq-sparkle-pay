-- SEARCH SPEND GUARD — durable, atomic, fleet-wide.
--
-- THE HOLE THIS CLOSES. smart-scout's only spend control was
-- `const rlBuckets = new Map()` at module scope: 10 requests/minute PER
-- ISOLATE, reset on every cold start. Supabase Edge recycles isolates freely,
-- so that bounded one isolate's burst and nothing else. Fleet-wide spend was
-- unbounded, at a measured ₹15.76–₹38.24 per query.
--
-- Everything here is deliberately shaped like claim_story_seconds, which is the
-- house pattern for "check and spend must not be two steps": one SECURITY
-- DEFINER function, one `select ... for update` row lock, one verdict.
--
-- FAIL CLOSED. If no budget row is configured for the day, admission is
-- REFUSED, not waved through. An absent ceiling is not an infinite ceiling —
-- that is the assumption that makes an unbounded-spend bug possible.

-- ---------------------------------------------------------------- config
create table if not exists public.search_budget_config (
  id              boolean primary key default true check (id),
  -- The ONLY monetary ceiling. Deliberately NOT given a business default here:
  -- what ONIQ is willing to spend a day is an owner decision, and inventing a
  -- number would be inventing a business decision.
  daily_usd_cap   numeric(10, 4) not null,
  -- Per-request ceiling, so one pathological query cannot eat the day.
  request_usd_cap numeric(10, 4) not null default 0.50,
  enabled         boolean        not null default true,
  updated_at      timestamptz    not null default now()
);

comment on table public.search_budget_config is
  'Single-row search spend ceiling. No row = admission refused (fail closed).';

-- ---------------------------------------------------------------- ledger
create table if not exists public.search_spend_ledger (
  id              uuid primary key default gen_random_uuid(),
  day             date        not null default (now() at time zone 'utc')::date,
  request_id      text        not null,
  user_id         uuid,
  search_type     text,
  provider        text        not null,
  model           text,
  -- Reserved up front, reconciled after. `actual_usd` stays null when the
  -- provider does not tell us what it charged — an unknown is recorded as
  -- unknown rather than back-filled from the estimate.
  estimated_usd   numeric(10, 6) not null,
  actual_usd      numeric(10, 6),
  state           text        not null default 'RESERVED'
                    check (state in ('RESERVED', 'SETTLED', 'RELEASED')),
  search_count    integer,
  llm_calls       integer,
  input_tokens    integer,
  output_tokens   integer,
  cache_hits      integer,
  termination_reason text,
  created_at      timestamptz not null default now(),
  settled_at      timestamptz
);

create unique index if not exists search_spend_ledger_request_uk
  on public.search_spend_ledger (request_id);
create index if not exists search_spend_ledger_day_state_idx
  on public.search_spend_ledger (day, state);

comment on table public.search_spend_ledger is
  'One row per admitted search request. RESERVED on admission, SETTLED on '
  'reconcile, RELEASED when the provider was never called.';

-- ---------------------------------------------------------------- rollup
-- A day row exists so admission can take ONE lock instead of aggregating the
-- ledger under contention.
create table if not exists public.search_spend_day (
  day            date primary key,
  reserved_usd   numeric(12, 6) not null default 0,
  settled_usd    numeric(12, 6) not null default 0,
  request_count  integer        not null default 0
);

alter table public.search_budget_config enable row level security;
alter table public.search_spend_ledger  enable row level security;
alter table public.search_spend_day     enable row level security;

-- No policies: these tables are reachable only through the SECURITY DEFINER
-- functions below. A client must never be able to read the ceiling or write
-- the ledger directly.
revoke all on public.search_budget_config from anon, authenticated;
revoke all on public.search_spend_ledger  from anon, authenticated;
revoke all on public.search_spend_day     from anon, authenticated;

-- ---------------------------------------------------------------- admit
--
-- ATOMIC ADMISSION. Locks the day row, checks the ceiling, reserves the
-- estimate and commits — so two concurrent workers cannot both see the same
-- remaining budget and both spend it.
create or replace function public.admit_search_spend(
  _request_id    text,
  _estimated_usd numeric,
  _provider      text,
  _model         text default null,
  _search_type   text default null,
  _user_id       uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg      public.search_budget_config%rowtype;
  today    date := (now() at time zone 'utc')::date;
  day_row  public.search_spend_day%rowtype;
  committed numeric;
  remaining numeric;
begin
  if _estimated_usd is null or _estimated_usd < 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid-estimate');
  end if;

  select * into cfg from public.search_budget_config where id = true;

  -- FAIL CLOSED. No configured ceiling means no admission.
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no-budget-configured',
      'remainingUsd', 0);
  end if;
  if not cfg.enabled then
    return jsonb_build_object('ok', false, 'reason', 'disabled', 'remainingUsd', 0);
  end if;
  if _estimated_usd > cfg.request_usd_cap then
    return jsonb_build_object('ok', false, 'reason', 'over-request-cap',
      'requestCapUsd', cfg.request_usd_cap, 'estimatedUsd', _estimated_usd);
  end if;

  -- Idempotent: the same request_id never reserves twice.
  if exists (select 1 from public.search_spend_ledger where request_id = _request_id) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate-request');
  end if;

  insert into public.search_spend_day (day) values (today) on conflict (day) do nothing;
  select * into day_row from public.search_spend_day where day = today for update;

  -- Reserved counts against the cap as if spent. Optimism here is exactly how
  -- concurrent workers overspend.
  committed := day_row.reserved_usd + day_row.settled_usd;
  remaining := cfg.daily_usd_cap - committed;

  if _estimated_usd > remaining then
    return jsonb_build_object('ok', false, 'reason', 'daily-cap-reached',
      'remainingUsd', greatest(remaining, 0), 'dailyCapUsd', cfg.daily_usd_cap);
  end if;

  insert into public.search_spend_ledger
    (request_id, user_id, search_type, provider, model, estimated_usd, state)
  values (_request_id, _user_id, _search_type, _provider, _model, _estimated_usd, 'RESERVED');

  update public.search_spend_day
     set reserved_usd  = reserved_usd + _estimated_usd,
         request_count = request_count + 1
   where day = today;

  return jsonb_build_object('ok', true, 'reason', 'admitted',
    'remainingUsd', remaining - _estimated_usd,
    'dailyCapUsd', cfg.daily_usd_cap,
    'requestCapUsd', cfg.request_usd_cap);
end;
$$;

-- ---------------------------------------------------------------- settle
--
-- Reconcile a reservation against what actually happened. `_actual_usd` null
-- means the provider did not report a cost: the ESTIMATE stands as the charge
-- rather than being silently zeroed. Do not fabricate a refund.
create or replace function public.settle_search_spend(
  _request_id         text,
  _actual_usd         numeric default null,
  _search_count       integer default null,
  _llm_calls          integer default null,
  _input_tokens       integer default null,
  _output_tokens      integer default null,
  _cache_hits         integer default null,
  _termination_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  led    public.search_spend_ledger%rowtype;
  charge numeric;
begin
  select * into led from public.search_spend_ledger
   where request_id = _request_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown-request');
  end if;
  if led.state <> 'RESERVED' then
    return jsonb_build_object('ok', false, 'reason', 'already-' || lower(led.state));
  end if;

  charge := coalesce(_actual_usd, led.estimated_usd);

  update public.search_spend_ledger
     set actual_usd = _actual_usd,
         state = 'SETTLED',
         search_count = _search_count,
         llm_calls = _llm_calls,
         input_tokens = _input_tokens,
         output_tokens = _output_tokens,
         cache_hits = _cache_hits,
         termination_reason = _termination_reason,
         settled_at = now()
   where request_id = _request_id;

  update public.search_spend_day
     set reserved_usd = greatest(reserved_usd - led.estimated_usd, 0),
         settled_usd  = settled_usd + charge
   where day = led.day;

  return jsonb_build_object('ok', true, 'reason', 'settled', 'chargedUsd', charge,
    'actualKnown', _actual_usd is not null);
end;
$$;

-- ---------------------------------------------------------------- release
--
-- ONLY for the case where the provider was never called. Releasing after a
-- provider call would be inventing a refund.
create or replace function public.release_search_spend(_request_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  led public.search_spend_ledger%rowtype;
begin
  select * into led from public.search_spend_ledger
   where request_id = _request_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown-request');
  end if;
  if led.state <> 'RESERVED' then
    return jsonb_build_object('ok', false, 'reason', 'already-' || lower(led.state));
  end if;

  update public.search_spend_ledger
     set state = 'RELEASED', settled_at = now()
   where request_id = _request_id;

  update public.search_spend_day
     set reserved_usd = greatest(reserved_usd - led.estimated_usd, 0)
   where day = led.day;

  return jsonb_build_object('ok', true, 'reason', 'released');
end;
$$;

-- Service role only. No anon, no authenticated: a client must never be able to
-- admit its own spend.
revoke all on function public.admit_search_spend(text, numeric, text, text, text, uuid)
  from anon, authenticated;
revoke all on function public.settle_search_spend(text, numeric, integer, integer, integer, integer, integer, text)
  from anon, authenticated;
revoke all on function public.release_search_spend(text) from anon, authenticated;
