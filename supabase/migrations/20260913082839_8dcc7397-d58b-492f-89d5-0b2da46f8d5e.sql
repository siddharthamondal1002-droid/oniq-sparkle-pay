alter table public.gateway_spend_ledger
  drop constraint if exists gateway_spend_values_are_finite;
alter table public.gateway_spend_ledger
  add constraint gateway_spend_values_are_finite
  check (
    (
      charged_credits is null
      or (charged_credits > '-Infinity'::numeric and charged_credits < 'Infinity'::numeric)
    )
    and (
      units_observed is null
      or (units_observed > '-Infinity'::numeric and units_observed < 'Infinity'::numeric)
    )
  )
  not valid;
alter table public.gateway_spend_ledger
  validate constraint gateway_spend_values_are_finite;

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
  _mismatch boolean;
begin
  select * into _existing
    from public.gateway_spend_ledger
   where request_id = _request_id
     for update;

  if not found then
    insert into public.gateway_spend_ledger (
      request_id, capability, provider, model, unit, job_id, attempt, user_id, detail
    ) values (
      _request_id, _capability, _provider, _model, _unit, _job_id, _attempt, _user_id, _detail
    )
    on conflict (request_id) do nothing
    returning * into _existing;

    if _existing.id is not null then
      return jsonb_build_object(
        'ok', true, 'duplicate', false, 'id', _existing.id,
        'settlementState', _existing.settlement_state
      );
    end if;

    select * into _existing
      from public.gateway_spend_ledger
     where request_id = _request_id
       for update;
    if not found then
      return jsonb_build_object('ok', false, 'duplicate', false, 'reason', 'capture-lost');
    end if;
  end if;

  _mismatch :=
       _existing.capability is distinct from _capability
    or _existing.provider   is distinct from _provider
    or _existing.model      is distinct from _model
    or _existing.unit       is distinct from _unit
    or _existing.job_id     is distinct from _job_id
    or _existing.attempt    is distinct from _attempt
    or _existing.user_id    is distinct from _user_id;

  if _mismatch then
    return jsonb_build_object(
      'ok', false, 'duplicate', true, 'reason', 'context-conflict',
      'id', _existing.id, 'settlementState', _existing.settlement_state
    );
  end if;

  return jsonb_build_object(
    'ok', true, 'duplicate', true, 'id', _existing.id,
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
  select * into _row
    from public.gateway_spend_ledger
   where request_id = _request_id
     for update;

  if _row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown-request');
  end if;

  if _charged_credits is not null
     and not (
       _charged_credits >= 0
       and _charged_credits > '-Infinity'::numeric
       and _charged_credits < 'Infinity'::numeric
     ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid-charge');
  end if;
  if _units_observed is not null
     and not (
       _units_observed >= 0
       and _units_observed > '-Infinity'::numeric
       and _units_observed < 'Infinity'::numeric
     ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid-units');
  end if;
  if _outcome = 'NOT_CALLED' and coalesce(_charged_credits, 0) <> 0 then
    return jsonb_build_object('ok', false, 'reason', 'not-called-cannot-charge');
  end if;

  if _row.charged_credits is not null
     and _charged_credits is not null
     and _row.charged_credits <> _charged_credits then
    return jsonb_build_object('ok', false, 'reason', 'charge-conflict');
  end if;

  if _row.provider_receipt_id is not null
     and _provider_receipt_id is not null
     and _row.provider_receipt_id <> _provider_receipt_id then
    return jsonb_build_object('ok', false, 'reason', 'receipt-conflict');
  end if;

  if _outcome = 'NOT_CALLED' then
    _state := 'NOT_CALLED';
  elsif coalesce(_charged_credits, _row.charged_credits) is not null then
    _state := 'SETTLED';
  else
    _state := 'PENDING_RECONCILIATION';
  end if;

  begin
    update public.gateway_spend_ledger
       set outcome             = _outcome,
           units_observed      = coalesce(_units_observed, units_observed),
           charged_credits     = coalesce(_charged_credits, charged_credits),
           provider_receipt_id = coalesce(_provider_receipt_id, provider_receipt_id),
           settlement_state    = _state,
           detail              = coalesce(_detail, detail)
     where id = _row.id
    returning * into _row;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'reason', 'receipt-conflict');
  end;

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