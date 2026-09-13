create unique index if not exists gateway_spend_receipt_identity_idx
  on public.gateway_spend_ledger (provider, provider_receipt_id)
  where provider_receipt_id is not null;

alter table public.gateway_spend_ledger
  drop constraint if exists gateway_spend_not_called_is_free;
alter table public.gateway_spend_ledger
  add constraint gateway_spend_not_called_is_free
  check (outcome is distinct from 'NOT_CALLED' or coalesce(charged_credits, 0) = 0)
  not valid;

alter table public.gateway_spend_ledger
  drop constraint if exists gateway_spend_values_are_finite;
alter table public.gateway_spend_ledger
  add constraint gateway_spend_values_are_finite
  check (
    (charged_credits is null or charged_credits = charged_credits)
    and (units_observed is null or units_observed = units_observed)
  )
  not valid;

alter table public.gateway_spend_ledger
  validate constraint gateway_spend_not_called_is_free;
alter table public.gateway_spend_ledger
  validate constraint gateway_spend_values_are_finite;

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
     and (_charged_credits < 0 or _charged_credits <> _charged_credits) then
    return jsonb_build_object('ok', false, 'reason', 'invalid-charge');
  end if;
  if _units_observed is not null
     and (_units_observed < 0 or _units_observed <> _units_observed) then
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

revoke all on function public.settle_gateway_spend(
  text, text, numeric, numeric, text, jsonb
) from public, anon, authenticated;
grant execute on function public.settle_gateway_spend(
  text, text, numeric, numeric, text, jsonb
) to service_role;