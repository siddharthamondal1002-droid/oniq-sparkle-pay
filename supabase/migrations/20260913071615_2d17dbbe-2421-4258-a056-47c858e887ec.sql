create table if not exists public.gateway_spend_ledger (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique,
  job_id text,
  attempt integer check (attempt is null or attempt > 0),
  capability text not null check (
    capability in ('TEXT', 'IMAGE', 'TTS', 'MUSIC', 'VIDEO', 'SEARCH', 'OTHER')
  ),
  provider text not null,
  model text not null,
  unit text not null check (
    unit in ('tokens', 'images', 'characters', 'video_seconds', 'provider_unit')
  ),
  units_observed numeric(14, 4) check (units_observed is null or units_observed >= 0),
  currency text not null default 'CREDITS' check (currency = 'CREDITS'),
  charged_credits numeric(14, 4) check (charged_credits is null or charged_credits >= 0),
  provider_receipt_id text,
  settlement_state text not null default 'PENDING_RECONCILIATION' check (
    settlement_state in ('PENDING_RECONCILIATION', 'SETTLED', 'NOT_CALLED', 'FAILED')
  ),
  outcome text check (
    outcome is null or outcome in ('ACCEPTED', 'REJECTED', 'FAILED', 'FILTERED', 'NOT_CALLED')
  ),
  user_id uuid references auth.users (id) on delete set null,
  detail jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gateway_spend_settled_has_price
    check (settlement_state <> 'SETTLED' or charged_credits is not null)
);

create index if not exists gateway_spend_job_idx on public.gateway_spend_ledger (job_id);
create index if not exists gateway_spend_pending_idx
  on public.gateway_spend_ledger (settlement_state, created_at);

grant select on public.gateway_spend_ledger to authenticated;
grant all on public.gateway_spend_ledger to service_role;

alter table public.gateway_spend_ledger enable row level security;

drop policy if exists "own gateway spend is readable" on public.gateway_spend_ledger;
create policy "own gateway spend is readable"
  on public.gateway_spend_ledger
  for select
  to authenticated
  using (user_id = auth.uid());

create or replace function public.gateway_spend_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists gateway_spend_touch on public.gateway_spend_ledger;
create trigger gateway_spend_touch
  before update on public.gateway_spend_ledger
  for each row execute function public.gateway_spend_touch_updated_at();

create or replace function public.capture_gateway_spend(
  _request_id text,
  _capability text,
  _provider text,
  _model text,
  _unit text,
  _job_id text default null,
  _attempt integer default null,
  _user_id uuid default null,
  _detail jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _existing public.gateway_spend_ledger%rowtype;
begin
  select * into _existing from public.gateway_spend_ledger where request_id = _request_id;
  if found then
    return jsonb_build_object(
      'ok', true, 'duplicate', true, 'id', _existing.id,
      'settlementState', _existing.settlement_state
    );
  end if;

  insert into public.gateway_spend_ledger (
    request_id, capability, provider, model, unit, job_id, attempt, user_id, detail
  ) values (
    _request_id, _capability, _provider, _model, _unit, _job_id, _attempt, _user_id, _detail
  )
  on conflict (request_id) do nothing
  returning * into _existing;

  if _existing.id is null then
    select * into _existing from public.gateway_spend_ledger where request_id = _request_id;
    return jsonb_build_object(
      'ok', true, 'duplicate', true, 'id', _existing.id,
      'settlementState', _existing.settlement_state
    );
  end if;

  return jsonb_build_object(
    'ok', true, 'duplicate', false, 'id', _existing.id,
    'settlementState', _existing.settlement_state
  );
end;
$$;

create or replace function public.settle_gateway_spend(
  _request_id text,
  _outcome text,
  _units_observed numeric default null,
  _charged_credits numeric default null,
  _provider_receipt_id text default null,
  _detail jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _row public.gateway_spend_ledger%rowtype;
  _state text;
begin
  if _outcome = 'NOT_CALLED' then
    _state := 'NOT_CALLED';
  elsif _charged_credits is not null then
    _state := 'SETTLED';
  else
    _state := 'PENDING_RECONCILIATION';
  end if;

  update public.gateway_spend_ledger
     set outcome             = _outcome,
         units_observed      = coalesce(_units_observed, units_observed),
         charged_credits     = coalesce(_charged_credits, charged_credits),
         provider_receipt_id = coalesce(_provider_receipt_id, provider_receipt_id),
         settlement_state    = case
                                 when charged_credits is not null and _charged_credits is null
                                   then 'SETTLED'
                                 else _state
                               end,
         detail              = coalesce(_detail, detail)
   where request_id = _request_id
  returning * into _row;

  if _row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown-request');
  end if;
  return jsonb_build_object(
    'ok', true, 'settlementState', _row.settlement_state,
    'chargedCredits', _row.charged_credits
  );
end;
$$;

revoke all on function public.capture_gateway_spend(
  text, text, text, text, text, text, integer, uuid, jsonb
) from public, anon, authenticated;
revoke all on function public.settle_gateway_spend(
  text, text, numeric, numeric, text, jsonb
) from public, anon, authenticated;
grant execute on function public.capture_gateway_spend(
  text, text, text, text, text, text, integer, uuid, jsonb
) to service_role;
grant execute on function public.settle_gateway_spend(
  text, text, numeric, numeric, text, jsonb
) to service_role;