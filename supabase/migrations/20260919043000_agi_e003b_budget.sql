-- E-003B experiment-level reservation ledger.
-- Provider calls remain guarded by provider_spend_*; this second layer prevents
-- retries/restarts from exceeding the preregistered 876-execution / $43.80 envelope.

create table if not exists public.agi_benchmark_budget (
  experiment_id text primary key,
  enabled boolean not null default false,
  cap_usd numeric(12,6) not null check (cap_usd > 0),
  per_execution_cap_usd numeric(12,6) not null check (per_execution_cap_usd > 0),
  execution_limit integer not null check (execution_limit > 0),
  reserved_usd numeric(12,6) not null default 0 check (reserved_usd >= 0),
  settled_usd numeric(12,6) not null default 0 check (settled_usd >= 0),
  executions_started integer not null default 0 check (executions_started >= 0),
  executions_completed integer not null default 0 check (executions_completed >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.agi_benchmark_runs (
  run_id text primary key,
  experiment_id text not null references public.agi_benchmark_budget(experiment_id),
  task_id text not null,
  arm text not null check (arm in ('direct','bounded-agent')),
  repeat integer not null check (repeat >= 0),
  visibility text not null check (visibility in ('public_dev','sealed_core','safety')),
  status text not null check (status in ('ADMITTED','SETTLED','FAILED')),
  reserved_usd numeric(12,6) not null check (reserved_usd > 0),
  actual_usd numeric(12,6),
  trace_hash text,
  evaluation_id text,
  failure text,
  admitted_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (experiment_id, task_id, arm, repeat)
);

alter table public.agi_benchmark_budget enable row level security;
alter table public.agi_benchmark_runs enable row level security;

-- No client policies: browser/authenticated users cannot read or mutate benchmark state.

insert into public.agi_benchmark_budget (
  experiment_id, enabled, cap_usd, per_execution_cap_usd, execution_limit
) values ('E-003B', false, 43.80, 0.05, 876)
on conflict (experiment_id) do update
set cap_usd = excluded.cap_usd,
    per_execution_cap_usd = excluded.per_execution_cap_usd,
    execution_limit = excluded.execution_limit,
    updated_at = now();

create or replace function public.admit_agi_benchmark_execution(
  _run_id text,
  _task_id text,
  _arm text,
  _repeat integer,
  _visibility text,
  _reserve_usd numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.agi_benchmark_budget%rowtype;
begin
  if _run_id is null or length(_run_id) < 8 or length(_run_id) > 96 then
    return jsonb_build_object('ok', false, 'reason', 'bad-run-id');
  end if;
  if _arm not in ('direct','bounded-agent') or _repeat < 0
     or _visibility not in ('public_dev','sealed_core','safety') then
    return jsonb_build_object('ok', false, 'reason', 'bad-run-shape');
  end if;

  select * into b
  from public.agi_benchmark_budget
  where experiment_id = 'E-003B'
  for update;

  if not found then return jsonb_build_object('ok', false, 'reason', 'budget-missing'); end if;
  if b.enabled is not true then return jsonb_build_object('ok', false, 'reason', 'experiment-disabled'); end if;
  if _reserve_usd <> b.per_execution_cap_usd then
    return jsonb_build_object('ok', false, 'reason', 'reserve-must-equal-execution-cap');
  end if;
  if b.executions_started >= b.execution_limit then
    return jsonb_build_object('ok', false, 'reason', 'execution-limit');
  end if;
  if b.settled_usd + b.reserved_usd + _reserve_usd > b.cap_usd then
    return jsonb_build_object('ok', false, 'reason', 'aggregate-budget');
  end if;

  begin
    insert into public.agi_benchmark_runs(
      run_id, experiment_id, task_id, arm, repeat, visibility, status, reserved_usd
    ) values (
      _run_id, 'E-003B', _task_id, _arm, _repeat, _visibility, 'ADMITTED', _reserve_usd
    );
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'duplicate-execution');
  end;

  update public.agi_benchmark_budget
  set reserved_usd = reserved_usd + _reserve_usd,
      executions_started = executions_started + 1,
      updated_at = now()
  where experiment_id = 'E-003B';

  return jsonb_build_object(
    'ok', true,
    'reason', 'admitted',
    'remainingUsd', b.cap_usd - b.settled_usd - b.reserved_usd - _reserve_usd,
    'executionsRemaining', b.execution_limit - b.executions_started - 1
  );
end;
$$;

create or replace function public.settle_agi_benchmark_execution(
  _run_id text,
  _actual_usd numeric,
  _trace_hash text,
  _evaluation_id text default null,
  _failure text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.agi_benchmark_runs%rowtype;
  b public.agi_benchmark_budget%rowtype;
begin
  select * into r
  from public.agi_benchmark_runs
  where run_id = _run_id
  for update;

  if not found then return jsonb_build_object('ok', false, 'reason', 'run-missing'); end if;
  if r.status <> 'ADMITTED' then return jsonb_build_object('ok', false, 'reason', 'already-settled'); end if;
  if _actual_usd is null or _actual_usd < 0 or _actual_usd > r.reserved_usd then
    return jsonb_build_object('ok', false, 'reason', 'invalid-actual');
  end if;
  if _trace_hash is null or length(_trace_hash) < 32 then
    return jsonb_build_object('ok', false, 'reason', 'trace-required');
  end if;

  select * into b
  from public.agi_benchmark_budget
  where experiment_id = r.experiment_id
  for update;

  update public.agi_benchmark_runs
  set status = case when _failure is null then 'SETTLED' else 'FAILED' end,
      actual_usd = _actual_usd,
      trace_hash = _trace_hash,
      evaluation_id = _evaluation_id,
      failure = _failure,
      settled_at = now()
  where run_id = _run_id;

  update public.agi_benchmark_budget
  set reserved_usd = greatest(0, reserved_usd - r.reserved_usd),
      settled_usd = settled_usd + _actual_usd,
      executions_completed = executions_completed + 1,
      updated_at = now()
  where experiment_id = r.experiment_id;

  return jsonb_build_object('ok', true, 'reason', 'settled');
end;
$$;

create or replace function public.agi_benchmark_budget_status()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'experimentId', experiment_id,
    'enabled', enabled,
    'capUsd', cap_usd,
    'perExecutionCapUsd', per_execution_cap_usd,
    'executionLimit', execution_limit,
    'reservedUsd', reserved_usd,
    'settledUsd', settled_usd,
    'executionsStarted', executions_started,
    'executionsCompleted', executions_completed
  )
  from public.agi_benchmark_budget
  where experiment_id = 'E-003B';
$$;

revoke all on table public.agi_benchmark_budget from anon, authenticated;
revoke all on table public.agi_benchmark_runs from anon, authenticated;
revoke all on function public.admit_agi_benchmark_execution(text,text,text,integer,text,numeric) from public, anon, authenticated;
revoke all on function public.settle_agi_benchmark_execution(text,numeric,text,text,text) from public, anon, authenticated;
revoke all on function public.agi_benchmark_budget_status() from public, anon, authenticated;
grant execute on function public.admit_agi_benchmark_execution(text,text,text,integer,text,numeric) to service_role;
grant execute on function public.settle_agi_benchmark_execution(text,numeric,text,text,text) to service_role;
grant execute on function public.agi_benchmark_budget_status() to service_role;
