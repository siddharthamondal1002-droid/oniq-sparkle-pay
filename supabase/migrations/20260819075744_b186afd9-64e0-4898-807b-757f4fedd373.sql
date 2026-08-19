-- Track B — creator subscriptions. Additive. Reversible by dropping the
-- objects created here (nothing existing is altered or dropped).

-- THE PAYOUT GATE. Same singleton pattern as video_gen_config/story_config.
--
-- payouts_enabled DEFAULTS FALSE AND MUST STAY FALSE until three things exist
-- that are not code:
--   * a written CA opinion on section 194O TDS and section 52 CGST TCS,
--   * a TAN, and
--   * a separate GST registration under section 24(vi).
-- Flipping this without them is a tax compliance failure, not a bug. Accrual,
-- hold maturation and clawback all run normally while it is false; only the
-- money-movement call is refused.
create table if not exists public.creator_payout_config (
  id boolean primary key default true check (id),
  payouts_enabled boolean not null default false,
  hold_days integer not null default 45,
  min_payout_paise bigint not null default 100000,
  standard_commission_bp integer not null default 1000,
  founding_commission_bp integer not null default 750,
  founding_until date not null default date '2027-03-31',
  play_fee_bp integer not null default 1500,
  tds_194o_bp integer not null default 10,
  tds_194o_no_pan_bp integer not null default 500,
  tcs_52_bp integer not null default 100,
  breakeven_refund_bp integer not null default 1050,
  refund_review_bp integer not null default 500,
  direct_recovery_paise bigint not null default 1000000,
  writeoff_after_days integer not null default 180,
  payout_countries text[] not null default array['IN'],
  updated_at timestamptz not null default now()
);
insert into public.creator_payout_config (id) values (true) on conflict (id) do nothing;
grant select on public.creator_payout_config to authenticated;
grant all on public.creator_payout_config to service_role;
alter table public.creator_payout_config enable row level security;
create policy creator_payout_config_read on public.creator_payout_config
  for select to authenticated using (true);

-- B2 — a FIXED, SMALL set of shared SKUs. Play caps an app at 1,000 products
-- and 50 base plans per subscription, so there can never be a product per
-- creator. The creator is carried in obfuscatedAccountId at purchase and the
-- entitlement lives here, not in Play.
create table if not exists public.creator_sub_skus (
  sku text primary key,
  price_paise bigint not null check (price_paise > 0),
  label text not null,
  active boolean not null default true,
  sort integer not null default 0
);
insert into public.creator_sub_skus (sku, price_paise, label, sort) values
  ('oniq_creator_49',   4900,  'Rs 49/month',  1),
  ('oniq_creator_99',   9900,  'Rs 99/month',  2),
  ('oniq_creator_199', 19900, 'Rs 199/month',  3),
  ('oniq_creator_499', 49900, 'Rs 499/month',  4)
on conflict (sku) do nothing;
grant select on public.creator_sub_skus to authenticated;
grant all on public.creator_sub_skus to service_role;
alter table public.creator_sub_skus enable row level security;
create policy creator_sub_skus_read on public.creator_sub_skus
  for select to authenticated using (active);

-- B6 — who may be paid. 18+ is enforced HERE, at the data layer, over the
-- existing is_adult_18 (read, never modified). Country gate: no PA-CB partner.
create table if not exists public.creator_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','active','suspended','rejected')),
  kyc_status text not null default 'unverified'
    check (kyc_status in ('unverified','pending','verified','failed')),
  country_code text not null,
  has_pan boolean not null default false,
  founding boolean not null default false,
  followers_at_apply integer not null default 0,
  active_days_at_apply integer not null default 0,
  earnings_suspended boolean not null default false,
  applied_at timestamptz not null default now(),
  approved_at timestamptz
);
grant select, insert on public.creator_accounts to authenticated;
grant all on public.creator_accounts to service_role;
alter table public.creator_accounts enable row level security;
create policy creator_accounts_own_read on public.creator_accounts
  for select to authenticated using (user_id = auth.uid());

create or replace function public.creator_accounts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare cfg public.creator_payout_config;
begin
  select * into cfg from public.creator_payout_config where id;
  if not public.is_adult_18(new.user_id) then
    raise exception 'creator signup refused: 18+ required (data layer)'
      using errcode = 'check_violation';
  end if;
  if not (new.country_code = any (cfg.payout_countries)) then
    raise exception 'creator signup refused: no payout route for country %', new.country_code
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists creator_accounts_guard_trg on public.creator_accounts;
create trigger creator_accounts_guard_trg before insert or update on public.creator_accounts
  for each row execute function public.creator_accounts_guard();

-- B2/B3 — one row per Play purchase token. A subscriber paying two creators at
-- the same price point holds TWO purchases of the SAME sku, so the identity is
-- the token, never (subscriber, sku).
create table if not exists public.creator_subscriptions (
  id uuid primary key default gen_random_uuid(),
  purchase_token text not null unique,
  subscriber_id uuid not null references auth.users(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  sku text not null references public.creator_sub_skus(sku),
  price_paise bigint not null,
  status text not null default 'active'
    check (status in ('active','grace','on_hold','paused','canceled','expired','revoked')),
  store text not null default 'play',
  rc_app_user_id text,
  obfuscated_account_id text,
  started_at timestamptz not null default now(),
  current_period_end timestamptz,
  updated_at timestamptz not null default now(),
  check (subscriber_id <> creator_id)
);
create unique index if not exists creator_subscriptions_one_active
  on public.creator_subscriptions (subscriber_id, creator_id)
  where status in ('active','grace');
create index if not exists creator_subscriptions_creator on public.creator_subscriptions (creator_id);
grant select on public.creator_subscriptions to authenticated;
grant all on public.creator_subscriptions to service_role;
alter table public.creator_subscriptions enable row level security;
create policy creator_subscriptions_mine on public.creator_subscriptions
  for select to authenticated
  using (subscriber_id = auth.uid() or creator_id = auth.uid());

-- B4 — the ledger. APPEND ONLY, DOUBLE ENTRY. There is deliberately NO mutable
-- state column: accrued vs available is derived from available_at, and paid
-- from a settlement entry. A state column would be a row to UPDATE.
create table if not exists public.creator_ledger (
  id uuid primary key default gen_random_uuid(),
  txn_id uuid not null,
  account text not null check (account in (
    'cash_receivable','play_fee','creator_payable','oniq_commission',
    'clawback','tds_194o','tcs_52','payout_settled','written_off')),
  amount_paise bigint not null,
  creator_id uuid references auth.users(id) on delete cascade,
  subscription_id uuid references public.creator_subscriptions(id) on delete set null,
  purchase_token text,
  available_at timestamptz,
  reverses_entry_id uuid references public.creator_ledger(id),
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists creator_ledger_creator on public.creator_ledger (creator_id, account);
create index if not exists creator_ledger_txn on public.creator_ledger (txn_id);
grant select on public.creator_ledger to authenticated;
grant all on public.creator_ledger to service_role;
alter table public.creator_ledger enable row level security;
create policy creator_ledger_own on public.creator_ledger
  for select to authenticated using (creator_id = auth.uid());

create or replace function public.creator_ledger_append_only()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'creator_ledger is append-only: % refused (post a reversal entry instead)', tg_op
    using errcode = 'insufficient_privilege';
end $$;
drop trigger if exists creator_ledger_no_update on public.creator_ledger;
create trigger creator_ledger_no_update before update or delete on public.creator_ledger
  for each row execute function public.creator_ledger_append_only();

-- B3 — RTDN dedupe. Pub/Sub push is at-least-once, so messageId is the key.
create table if not exists public.creator_rtdn_events (
  message_id text primary key,
  notification_type integer,
  purchase_token text,
  sku text,
  payload jsonb,
  fetched_state jsonb,
  processed_at timestamptz,
  error text,
  received_at timestamptz not null default now()
);
grant all on public.creator_rtdn_events to service_role;
alter table public.creator_rtdn_events enable row level security;

-- B5 — every clawback is announced. No silent adjustments.
create table if not exists public.creator_clawback_notices (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  txn_id uuid not null,
  amount_paise bigint not null,
  reason text not null,
  period text,
  resulting_balance_paise bigint not null,
  notified_at timestamptz not null default now(),
  dispute_opened_at timestamptz,
  human_reply_due timestamptz,
  resolved_at timestamptz
);
create index if not exists creator_clawback_creator on public.creator_clawback_notices (creator_id);
grant select on public.creator_clawback_notices to authenticated;
grant all on public.creator_clawback_notices to service_role;
alter table public.creator_clawback_notices enable row level security;
create policy creator_clawback_own on public.creator_clawback_notices
  for select to authenticated using (creator_id = auth.uid());

-- Every payout attempt is recorded, including the refusals, so "no money
-- moved" is a thing you can query rather than a thing you believe.
create table if not exists public.creator_payout_attempts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null unique,
  amount_paise bigint not null,
  status text not null check (status in ('refused_gate','refused_threshold','refused_hold','refused_kyc','queued','paid','failed')),
  detail text,
  provider text,
  provider_payout_id text,
  created_at timestamptz not null default now()
);
create index if not exists creator_payout_attempts_creator on public.creator_payout_attempts (creator_id);
grant select on public.creator_payout_attempts to authenticated;
grant all on public.creator_payout_attempts to service_role;
alter table public.creator_payout_attempts enable row level security;
create policy creator_payout_attempts_own on public.creator_payout_attempts
  for select to authenticated using (creator_id = auth.uid());