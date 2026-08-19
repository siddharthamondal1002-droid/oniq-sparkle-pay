-- Owner-scoping. A definer function that takes a uuid and answers about it is
-- a read of anybody's earnings by anybody; these answer about the caller only.
create or replace function public.creator_balance(_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with allowed as (select (auth.uid() = _uid or public.is_admin(auth.uid())) ok),
  e as (
    select l.amount_paise, l.available_at, l.account from public.creator_ledger l, allowed a
     where a.ok and l.creator_id = _uid and l.account in ('creator_payable','clawback','payout_settled')
  )
  select jsonb_build_object(
    'accruedPaise',   coalesce(sum(amount_paise) filter (where available_at > now()), 0),
    'availablePaise', coalesce(sum(amount_paise) filter (where available_at is null or available_at <= now()), 0),
    'paidPaise',      coalesce(-sum(amount_paise) filter (where account = 'payout_settled'), 0),
    'netPaise',       coalesce(sum(amount_paise), 0))
  from e;
$$;

create or replace function public.creator_eligibility(_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not (auth.uid() = _uid or public.is_admin(auth.uid()))
              then jsonb_build_object('ok', false, 'error', 'not your account')
  else jsonb_build_object(
    'followers', (select count(*) from public.follows where followee_id = _uid),
    'minFollowers', 1000,
    'activeDays', public.creator_activity_days(_uid, 90),
    'minActiveDays', 10,
    'adult', public.is_adult_18(_uid),
    'country', (select country_code from public.profiles where id = _uid),
    'payoutCountries', (select payout_countries from public.creator_payout_config where id),
    'kyc', coalesce((select kyc_status from public.creator_accounts where user_id = _uid), 'unverified'),
    'status', coalesce((select status from public.creator_accounts where user_id = _uid), 'none')) end;
$$;

create or replace function public.creator_refund_rate(_uid uuid, _days integer default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  with allowed as (select (auth.uid() = _uid or public.is_admin(auth.uid())) ok),
  charges as (
    select count(*) n from public.creator_ledger l, allowed a
     where a.ok and l.creator_id = _uid and l.account = 'creator_payable'
       and l.reverses_entry_id is null and l.created_at > now() - make_interval(days => _days)),
  refunds as (
    select count(*) n from public.creator_ledger l, allowed a
     where a.ok and l.creator_id = _uid and l.account = 'clawback'
       and l.created_at > now() - make_interval(days => _days))
  select jsonb_build_object(
    'charges', c.n, 'refunds', r.n,
    'refundBp', case when c.n = 0 then 0 else (r.n * 10000) / c.n end,
    'reviewBp', (select refund_review_bp from public.creator_payout_config where id),
    'breakevenBp', (select breakeven_refund_bp from public.creator_payout_config where id),
    'holdForReview', case when c.n = 0 then false
                          else (r.n * 10000) / c.n >=
                               (select refund_review_bp from public.creator_payout_config where id) end)
  from charges c, refunds r;
$$;

-- request_creator_payout must act for the caller, never for someone else.
create or replace function public.request_creator_payout(_uid uuid, _idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg public.creator_payout_config; bal jsonb; acct public.creator_accounts;
        rate jsonb; amt bigint; st text; detail text;
begin
  if not (auth.uid() = _uid or public.is_admin(auth.uid())) then
    raise exception 'not your account' using errcode = 'insufficient_privilege';
  end if;
  select * into cfg from public.creator_payout_config where id;
  select * into acct from public.creator_accounts where user_id = _uid;
  bal  := public.creator_balance(_uid);
  rate := public.creator_refund_rate(_uid, 30);
  amt  := greatest((bal->>'availablePaise')::bigint, 0);

  if not cfg.payouts_enabled then
    st := 'refused_gate';
    detail := 'payouts_enabled is false: awaiting CA opinion on 194O/52 CGST, TAN and GST registration under 24(vi)';
  elsif acct.user_id is null or acct.kyc_status <> 'verified' or acct.status <> 'active' then
    st := 'refused_kyc'; detail := 'creator not active with verified KYC';
  elsif (rate->>'holdForReview')::boolean then
    st := 'refused_hold'; detail := 'refund rate over review threshold in last 30 days';
  elsif amt < cfg.min_payout_paise then
    st := 'refused_threshold';
    detail := format('available %s paise is under the %s paise threshold', amt, cfg.min_payout_paise);
  else
    st := 'queued'; detail := null;
  end if;

  insert into public.creator_payout_attempts (creator_id, idempotency_key, amount_paise, status, detail, provider)
  values (_uid, _idempotency_key, amt, st, detail, 'cashfree')
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object('ok', st = 'queued', 'status', st, 'detail', detail,
                            'amountPaise', amt, 'payoutsEnabled', cfg.payouts_enabled);
end $$;

revoke execute on function public.creator_balance(uuid) from public, anon;
revoke execute on function public.creator_eligibility(uuid) from public, anon;
revoke execute on function public.creator_refund_rate(uuid,integer) from public, anon;
revoke execute on function public.creator_activity_days(uuid,integer) from public, anon, authenticated;
revoke execute on function public.creator_split(bigint,boolean) from public, anon, authenticated;
revoke execute on function public.creator_accounts_guard() from public, anon, authenticated;
revoke execute on function public.creator_ledger_append_only() from public, anon, authenticated;
revoke execute on function public.request_creator_payout(uuid,text) from public, anon;
grant execute on function public.creator_balance(uuid) to authenticated;
grant execute on function public.creator_eligibility(uuid) to authenticated;
grant execute on function public.creator_refund_rate(uuid,integer) to authenticated;
grant execute on function public.request_creator_payout(uuid,text) to authenticated;