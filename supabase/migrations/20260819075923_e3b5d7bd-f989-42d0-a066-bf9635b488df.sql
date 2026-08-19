-- Track B, part 2 — the money logic. All SECURITY DEFINER with a pinned
-- search_path. Reversible: drop function ... (nothing existing is altered).

create or replace function public.creator_split(_gross_paise bigint, _founding boolean)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'gross', _gross_paise,
    'play',  (_gross_paise * c.play_fee_bp) / 10000,
    'oniq',  (_gross_paise * case when _founding then c.founding_commission_bp
                                  else c.standard_commission_bp end) / 10000,
    'creator', _gross_paise
              - (_gross_paise * c.play_fee_bp) / 10000
              - (_gross_paise * case when _founding then c.founding_commission_bp
                                     else c.standard_commission_bp end) / 10000)
  from public.creator_payout_config c where c.id;
$$;

-- B6 — the activity requirement, which is the part that filters bought
-- followers. A raw follower gate rewards buying them.
create or replace function public.creator_activity_days(_uid uuid, _days integer default 90)
returns integer language sql stable security definer set search_path = public as $$
  select count(distinct d)::int from (
    select date_trunc('day', created_at) d from public.moments_posts
      where user_id = _uid and created_at > now() - make_interval(days => _days)
    union
    select date_trunc('day', created_at) d from public.clips
      where user_id = _uid and created_at > now() - make_interval(days => _days)
  ) s;
$$;

create or replace function public.creator_eligibility(_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'followers', (select count(*) from public.follows where followee_id = _uid),
    'minFollowers', 1000,
    'activeDays', public.creator_activity_days(_uid, 90),
    'minActiveDays', 10,
    'adult', public.is_adult_18(_uid),
    'country', (select country_code from public.profiles where id = _uid),
    'payoutCountries', (select payout_countries from public.creator_payout_config where id),
    'kyc', coalesce((select kyc_status from public.creator_accounts where user_id = _uid), 'unverified'),
    'status', coalesce((select status from public.creator_accounts where user_id = _uid), 'none'));
$$;

create or replace function public.record_creator_charge(
  _purchase_token text, _subscriber uuid, _creator uuid, _sku text,
  _gross_paise bigint, _period_end timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg public.creator_payout_config;
  acct public.creator_accounts;
  split jsonb; sub_id uuid; txn uuid := gen_random_uuid(); avail timestamptz;
begin
  select * into cfg from public.creator_payout_config where id;
  -- B8. Self-subscription is refused outright, before anything is written.
  if _subscriber = _creator then
    raise exception 'self-subscription refused' using errcode = 'check_violation';
  end if;
  select * into acct from public.creator_accounts where user_id = _creator;
  if acct.user_id is null or acct.status <> 'active' then
    raise exception 'creator % is not an active creator', _creator using errcode = 'check_violation';
  end if;

  insert into public.creator_subscriptions
    (purchase_token, subscriber_id, creator_id, sku, price_paise, current_period_end, obfuscated_account_id)
  values (_purchase_token, _subscriber, _creator, _sku, _gross_paise, _period_end, _creator::text)
  on conflict (purchase_token) do update
    set status = 'active', current_period_end = excluded.current_period_end, updated_at = now()
  returning id into sub_id;

  split := public.creator_split(_gross_paise, acct.founding and current_date <= cfg.founding_until);
  -- B4: the 45-day hold. Accrued until this instant, available after it.
  avail := now() + make_interval(days => cfg.hold_days);

  -- Suspended earnings are withheld going forward, never confiscated
  -- backwards: past entries stand untouched, the current share is simply not
  -- posted to the creator.
  insert into public.creator_ledger (txn_id, account, amount_paise, creator_id, subscription_id, purchase_token, available_at, reason)
  values
    (txn, 'cash_receivable',  (split->>'gross')::bigint,    _creator, sub_id, _purchase_token, null, 'play charge'),
    (txn, 'play_fee',        -(split->>'play')::bigint,     _creator, sub_id, _purchase_token, null, 'play service fee 15%'),
    (txn, 'oniq_commission', -((split->>'oniq')::bigint
                               + case when acct.earnings_suspended then (split->>'creator')::bigint else 0 end),
                                                            _creator, sub_id, _purchase_token, null, 'oniq commission'),
    (txn, 'creator_payable', case when acct.earnings_suspended then 0
                                  else (split->>'creator')::bigint end,
                                                            _creator, sub_id, _purchase_token, avail, 'creator earnings');
  return jsonb_build_object('ok', true, 'txn', txn, 'subscriptionId', sub_id,
                            'split', split, 'availableAt', avail);
end $$;

-- Accrued and Available are SEPARATE numbers from day one. Showing one number
-- and later reducing it is the fastest way to lose a creator.
create or replace function public.creator_balance(_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with e as (
    select amount_paise, available_at, account from public.creator_ledger
     where creator_id = _uid and account in ('creator_payable','clawback','payout_settled')
  )
  select jsonb_build_object(
    'accruedPaise',   coalesce(sum(amount_paise) filter (where available_at > now()), 0),
    'availablePaise', coalesce(sum(amount_paise) filter (where available_at is null or available_at <= now()), 0),
    'paidPaise',      coalesce(-sum(amount_paise) filter (where account = 'payout_settled'), 0),
    'netPaise',       coalesce(sum(amount_paise), 0))
  from e;
$$;

-- B5 — clawback. A refund is a NEW reversal entry that references the
-- original; the original row is never touched. Recovery order falls out of
-- available_at: a reversal is dated now(), so it offsets Available first, then
-- Accrued, then simply carries forward as a negative balance. A creator's bank
-- account is NEVER debited — no mandate exists and doing so turns a billing
-- dispute into a legal one.
create or replace function public.record_creator_refund(_purchase_token text, _reason text default 'refund')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  txn uuid := gen_random_uuid(); e record; total bigint := 0; who uuid; bal jsonb;
begin
  for e in
    select l.* from public.creator_ledger l
     where l.purchase_token = _purchase_token
       and l.reverses_entry_id is null
       and l.account in ('cash_receivable','play_fee','oniq_commission','creator_payable')
       and not exists (select 1 from public.creator_ledger r where r.reverses_entry_id = l.id)
  loop
    who := e.creator_id;
    insert into public.creator_ledger
      (txn_id, account, amount_paise, creator_id, subscription_id, purchase_token,
       available_at, reverses_entry_id, reason)
    values (txn,
            case when e.account = 'creator_payable' then 'clawback' else e.account end,
            -e.amount_paise, e.creator_id, e.subscription_id, e.purchase_token,
            case when e.account = 'creator_payable' then now() else null end,
            e.id, _reason);
    if e.account = 'creator_payable' then total := total + e.amount_paise; end if;
  end loop;

  update public.creator_subscriptions set status = 'revoked', updated_at = now()
   where purchase_token = _purchase_token;

  if who is not null and total > 0 then
    bal := public.creator_balance(who);
    insert into public.creator_clawback_notices
      (creator_id, txn_id, amount_paise, reason, period, resulting_balance_paise, human_reply_due)
    values (who, txn, total, _reason, to_char(now(), 'YYYY-MM'),
            (bal->>'netPaise')::bigint, now() + interval '7 days');
  end if;
  return jsonb_build_object('ok', true, 'txn', txn, 'reversedPaise', total);
end $$;

-- B5 — break-even is ~10.5% unrecovered refunds at a 10% commission.
create or replace function public.creator_refund_rate(_uid uuid, _days integer default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  with charges as (
    select count(*) n from public.creator_ledger
     where creator_id = _uid and account = 'creator_payable'
       and reverses_entry_id is null and created_at > now() - make_interval(days => _days)),
  refunds as (
    select count(*) n from public.creator_ledger
     where creator_id = _uid and account = 'clawback'
       and created_at > now() - make_interval(days => _days))
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

-- THE ONLY DOOR TO MONEY MOVEMENT, AND IT IS BOLTED. Nothing else may create a
-- payout: the provider call is made only for a row this function put in
-- 'queued', and it never does that while payouts_enabled is false.
create or replace function public.request_creator_payout(_uid uuid, _idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg public.creator_payout_config; bal jsonb; acct public.creator_accounts;
        rate jsonb; amt bigint; st text; detail text;
begin
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

-- B7 — tax accrues on the payout, and TDS and TCS are SEPARATE accounts
-- because they are separate liabilities to separate authorities. TDS once
-- deposited cannot be recovered on a later clawback, which is exactly why it
-- may not share an account with earnings.
create or replace function public.settle_creator_payout(_attempt uuid, _provider_payout_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg public.creator_payout_config; a public.creator_payout_attempts;
        acct public.creator_accounts; txn uuid := gen_random_uuid(); tds bigint; tcs bigint;
begin
  select * into cfg from public.creator_payout_config where id;
  if not cfg.payouts_enabled then
    raise exception 'payouts_enabled is false: no payout may settle' using errcode = 'insufficient_privilege';
  end if;
  select * into a from public.creator_payout_attempts where id = _attempt and status = 'queued';
  if a.id is null then raise exception 'no queued payout attempt %', _attempt; end if;
  select * into acct from public.creator_accounts where user_id = a.creator_id;
  tds := (a.amount_paise * case when acct.has_pan then cfg.tds_194o_bp else cfg.tds_194o_no_pan_bp end) / 10000;
  tcs := (a.amount_paise * cfg.tcs_52_bp) / 10000;
  insert into public.creator_ledger (txn_id, account, amount_paise, creator_id, reason) values
    (txn, 'payout_settled', -a.amount_paise, a.creator_id, 'payout ' || _provider_payout_id),
    (txn, 'tds_194o',        tds,            a.creator_id, 'section 194O 0.1% (5% without PAN) — not recoverable on clawback'),
    (txn, 'tcs_52',          tcs,            a.creator_id, 'section 52 CGST 1% — monthly GSTR-8');
  update public.creator_payout_attempts
     set status = 'paid', provider_payout_id = _provider_payout_id where id = _attempt;
  return jsonb_build_object('ok', true, 'tdsPaise', tds, 'tcsPaise', tcs);
end $$;

revoke execute on function public.record_creator_charge(text,uuid,uuid,text,bigint,timestamptz) from public, anon, authenticated;
revoke execute on function public.record_creator_refund(text,text) from public, anon, authenticated;
revoke execute on function public.settle_creator_payout(uuid,text) from public, anon, authenticated;
revoke execute on function public.request_creator_payout(uuid,text) from public, anon;
revoke execute on function public.creator_split(bigint,boolean) from anon;
revoke execute on function public.creator_activity_days(uuid,integer) from anon;
revoke execute on function public.creator_eligibility(uuid) from anon;
revoke execute on function public.creator_balance(uuid) from anon;
revoke execute on function public.creator_refund_rate(uuid,integer) from anon;
grant execute on function public.creator_balance(uuid) to authenticated;
grant execute on function public.creator_eligibility(uuid) to authenticated;
grant execute on function public.creator_refund_rate(uuid,integer) to authenticated;
grant execute on function public.request_creator_payout(uuid,text) to authenticated;