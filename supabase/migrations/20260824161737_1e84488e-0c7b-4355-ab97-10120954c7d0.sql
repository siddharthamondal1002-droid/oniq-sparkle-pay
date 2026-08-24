-- PROVIDER BUDGET INVARIANTS — make an invalid ceiling impossible to store.
--
-- THE BUG THIS CLOSES, AND IT IS NOT HYPOTHETICAL.
--
-- PostgreSQL's `numeric` accepts 'NaN' and 'Infinity', and orders them ABOVE
-- every real number. Measured on PostgreSQL 16.13:
--
--   'NaN'::numeric > 0        -> true
--   'NaN'::numeric = 'NaN'    -> true
--   'Infinity'::numeric > 0   -> true
--
-- So a naive `check (daily_usd_cap > 0)` HAPPILY ACCEPTS a NaN cap. And once
-- one is stored, admission computes `remaining := NaN - committed` = NaN, then
-- tests `_estimated_usd > NaN`, which is FALSE — so every request is admitted.
-- That is "missing cap = unlimited spend" wearing a different hat, which is the
-- one failure mode this whole ledger exists to make impossible.
--
-- THE ORDERING INVARIANT. request <= job <= daily is not a style preference:
--   - a request cap above the job cap lets ONE call exceed the whole job
--   - a job cap above the daily cap lets ONE job exceed the whole day
-- Either way the smaller ceiling is decorative. An invalid configuration is
-- REJECTED at write time; it is never silently normalised.

-- ------------------------------------------------------------------ finite
--
-- A single place that answers "is this a real, spendable amount of money?".
-- IMMUTABLE + STRICT so it can be used inside a CHECK constraint.
create or replace function public.is_spendable_usd(v numeric)
returns boolean
language sql
immutable
strict
set search_path = public
as $$
  -- The NaN test must come FIRST and must be an equality test: NaN compares
  -- greater-than every finite value, so any ordering test would wave it past.
  select v <> 'NaN'::numeric
     and v <> 'Infinity'::numeric
     and v <> '-Infinity'::numeric
     and v > 0;
$$;

comment on function public.is_spendable_usd(numeric) is
  'True only for a finite, strictly positive USD amount. NaN and +/-Infinity '
  'are rejected explicitly because numeric orders them above every real value.';

-- ------------------------------------------------------------------ checks
do $$
begin
  -- Every ceiling must be a real, positive amount of money.
  if not exists (
    select 1 from pg_constraint where conname = 'provider_budget_config_caps_spendable'
  ) then
    alter table public.provider_budget_config
      add constraint provider_budget_config_caps_spendable check (
        public.is_spendable_usd(request_usd_cap)
        and public.is_spendable_usd(job_usd_cap)
        and public.is_spendable_usd(daily_usd_cap)
      );
  end if;

  -- request <= job <= daily. Enforced, never normalised.
  if not exists (
    select 1 from pg_constraint where conname = 'provider_budget_config_cap_ordering'
  ) then
    alter table public.provider_budget_config
      add constraint provider_budget_config_cap_ordering check (
        request_usd_cap <= job_usd_cap
        and job_usd_cap <= daily_usd_cap
      );
  end if;

  -- An attempt ceiling is a COUNT, not money, and it has its own sane range.
  -- The upper bound exists because "999" is not a retry policy, it is the
  -- absence of one.
  if not exists (
    select 1 from pg_constraint where conname = 'provider_budget_config_attempts_sane'
  ) then
    alter table public.provider_budget_config
      add constraint provider_budget_config_attempts_sane check (
        max_attempts_per_job between 1 and 10
      );
  end if;
end $$;

-- ------------------------------------------------------------------ status
--
-- WHAT THE APPLICATION ASKS BEFORE IT PLANS ANYTHING.
--
-- Separate from admission on purpose: admission answers "may THIS request
-- spend?", this answers "is this capability configured to spend at all?" — the
-- question a UI, a worker preflight or a health check needs, and the one whose
-- honest answer is a REASON, not a boolean.
create or replace function public.provider_budget_status(_capability text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cfg public.provider_budget_config%rowtype;
begin
  select * into cfg from public.provider_budget_config where capability = _capability;

  if not found then
    -- The named state the owner asked for. NOT "unlimited", NOT "0".
    return jsonb_build_object(
      'capability', _capability,
      'generationAllowed', false,
      'reason', 'SPEND_CAP_UNSET',
      'capsConfigured', false);
  end if;

  if not cfg.enabled then
    return jsonb_build_object(
      'capability', _capability,
      'generationAllowed', false,
      'reason', 'CAPABILITY_DISABLED',
      'capsConfigured', true,
      'requestUsdCap', cfg.request_usd_cap,
      'jobUsdCap', cfg.job_usd_cap,
      'dailyUsdCap', cfg.daily_usd_cap,
      'maxAttemptsPerJob', cfg.max_attempts_per_job);
  end if;

  return jsonb_build_object(
    'capability', _capability,
    'generationAllowed', true,
    'reason', 'CONFIGURED',
    'capsConfigured', true,
    'requestUsdCap', cfg.request_usd_cap,
    'jobUsdCap', cfg.job_usd_cap,
    'dailyUsdCap', cfg.daily_usd_cap,
    'maxAttemptsPerJob', cfg.max_attempts_per_job);
end;
$$;

comment on function public.provider_budget_status(text) is
  'Is this capability configured to spend? Returns a REASON, never a bare '
  'boolean: SPEND_CAP_UNSET / CAPABILITY_DISABLED / CONFIGURED.';

-- ------------------------------------------------------------------ admit
--
-- Harden admission against the same non-finite values, at the door rather than
-- by luck. Today a NaN estimate happens to fail closed (NaN > cap is true, so
-- it is refused as over-request-cap) — but that is an accident of numeric's
-- ordering, and an accident is not a control.
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
  if _estimated_usd is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid-estimate');
  end if;
  -- NaN / Infinity FIRST, by equality. Ordering tests cannot catch them.
  if _estimated_usd = 'NaN'::numeric
     or _estimated_usd = 'Infinity'::numeric
     or _estimated_usd = '-Infinity'::numeric then
    return jsonb_build_object('ok', false, 'reason', 'non-finite-estimate');
  end if;
  if _estimated_usd < 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid-estimate');
  end if;
  -- A zero reservation is how an unpriced call sneaks through on a
  -- technicality. There is no such thing as a free provider call here.
  if _estimated_usd = 0 then
    return jsonb_build_object('ok', false, 'reason', 'zero-estimate');
  end if;
  if _units is not null and (_units = 'NaN'::numeric or _units < 0) then
    return jsonb_build_object('ok', false, 'reason', 'invalid-units');
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
  -- Defence in depth: the CHECK constraints above make an unusable ceiling
  -- unstorable, but a row written before they existed would still be here.
  if not (public.is_spendable_usd(cfg.request_usd_cap)
          and public.is_spendable_usd(cfg.job_usd_cap)
          and public.is_spendable_usd(cfg.daily_usd_cap)
          and cfg.request_usd_cap <= cfg.job_usd_cap
          and cfg.job_usd_cap <= cfg.daily_usd_cap) then
    return jsonb_build_object('ok', false, 'reason', 'invalid-budget-configuration',
      'capability', _capability);
  end if;

  -- EXACTLY EQUAL TO A CEILING IS ADMITTED. Documented, tested, and the same
  -- rule at all three ceilings: a ceiling is the most that may be spent, not
  -- the first amount that may not.
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

revoke all on function public.provider_budget_status(text) from anon, authenticated;
revoke all on function public.is_spendable_usd(numeric) from anon, authenticated;
revoke all on function public.admit_provider_spend(text, text, text, text, text, numeric, numeric, text, uuid, jsonb)
  from anon, authenticated;