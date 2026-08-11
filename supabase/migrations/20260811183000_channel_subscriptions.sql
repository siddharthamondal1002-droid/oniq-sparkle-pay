-- Channel subscriptions — everyone in the money flow gets paid.
--
-- THE PRODUCT. A channel owner (the influencer) names a monthly price for
-- their channel. A subscriber pays it through Razorpay — on the WEB, via the
-- same native link-out posture as Story time (/pay/subscribe opens in the
-- system browser from the app), which is what keeps the Play Billing
-- position identical to the one already documented in razorpay-order. Each
-- payment buys 30 days; renewal is another explicit payment, not an
-- e-mandate — autopay is a different Razorpay product with its own
-- compliance surface, and a tap a month is honest v1.
--
-- THE SPLIT, and why it is a config row: the owner said it plainly — the
-- subscriber gets paid, the influencer gets paid, and ONIQ gets paid. Split
-- defaults: creator 70%, ONIQ 25%, subscriber 5% BACK as wallet cashback.
-- Creator and cashback shares land in ONIQ WALLETS through the same
-- SECURITY DEFINER ledger discipline as every other balance change (the
-- ledger types already cover it — 'reward'); ONIQ's share is the remainder
-- and is recorded on the subscription row so the books add up row by row.
-- All three legs are written IN ONE FUNCTION, atomically: a split that can
-- half-happen is how a platform quietly owes people money.
--
-- GUARDRAILS, same order as everywhere else: the client never names a
-- price; the price comes from channel_sub_config, written only by the
-- channel owner through a bounded RPC. Credit is idempotent by
-- provider_order_id and service-role only; the webhook signature is the
-- authentication, exactly as for Story purchases.

-- ---------------------------------------------------------------------------
-- What a channel charges.
-- ---------------------------------------------------------------------------
create table if not exists public.channel_sub_config (
  channel_id uuid primary key references public.conversations(id) on delete cascade,
  price_paise int not null check (price_paise >= 1000 and price_paise <= 1000000),
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

grant select on public.channel_sub_config to authenticated;
alter table public.channel_sub_config enable row level security;
-- Anyone signed in may READ a channel's price — it is a shop window.
drop policy if exists "sub config readable" on public.channel_sub_config;
create policy "sub config readable" on public.channel_sub_config
  for select to authenticated using (true);
-- All writes go through the RPC below. No insert/update/delete policies.

-- ---------------------------------------------------------------------------
-- The split. One row, editable by hand in an emergency, never by clients.
-- ---------------------------------------------------------------------------
create table if not exists public.channel_sub_split_config (
  id boolean primary key default true check (id),
  creator_pct int not null default 70 check (creator_pct between 0 and 100),
  oniq_pct int not null default 25 check (oniq_pct between 0 and 100),
  cashback_pct int not null default 5 check (cashback_pct between 0 and 100),
  check (creator_pct + oniq_pct + cashback_pct = 100),
  updated_at timestamptz not null default now()
);
insert into public.channel_sub_split_config (id) values (true) on conflict (id) do nothing;
grant select on public.channel_sub_split_config to authenticated;
alter table public.channel_sub_split_config enable row level security;
drop policy if exists "split readable" on public.channel_sub_split_config;
create policy "split readable" on public.channel_sub_split_config
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- The subscriptions themselves — one row per PAYMENT (a renewal is a new
-- row), because each row is a receipt and receipts do not mutate.
-- ---------------------------------------------------------------------------
create table if not exists public.channel_subscriptions (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.conversations(id) on delete cascade,
  subscriber_id uuid not null references public.profiles(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  price_paise int not null check (price_paise > 0),
  currency text not null default 'INR',
  status text not null default 'created' check (status in ('created','active','failed')),
  -- The split as it was applied, in paise. Filled at credit time; the three
  -- legs plus nothing else must sum to price_paise.
  creator_paise int,
  cashback_paise int,
  oniq_paise int,
  origin text not null default 'web' check (origin in ('web','native-handoff')),
  provider_order_id text,
  provider_payment_id text,
  confirmed_by text,
  error text,
  period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists channel_subs_subscriber_idx
  on public.channel_subscriptions (subscriber_id, channel_id, status, period_end desc);
create index if not exists channel_subs_provider_idx
  on public.channel_subscriptions (provider_order_id);
create index if not exists channel_subs_creator_idx
  on public.channel_subscriptions (creator_id, status, created_at desc);

grant select on public.channel_subscriptions to authenticated;
alter table public.channel_subscriptions enable row level security;
-- A subscriber sees their receipts; a creator sees their channel's.
drop policy if exists "subs visible to their parties" on public.channel_subscriptions;
create policy "subs visible to their parties" on public.channel_subscriptions
  for select to authenticated
  using (subscriber_id = auth.uid() or creator_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Owner names the price. Bounded ₹10–₹10,000/month.
-- ---------------------------------------------------------------------------
create or replace function public.set_channel_sub_price(
  _channel_id uuid,
  _price_paise int,
  _enabled boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  if _price_paise < 1000 or _price_paise > 1000000 then
    return jsonb_build_object('ok', false, 'reason', 'bad-price');
  end if;
  if not exists (
    select 1
      from conversations c
      join conversation_members m on m.conversation_id = c.id
     where c.id = _channel_id and c.type = 'channel'
       and m.user_id = me and m.role = 'owner'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not-your-channel');
  end if;

  insert into channel_sub_config (channel_id, price_paise, enabled, updated_at)
  values (_channel_id, _price_paise, coalesce(_enabled, true), now())
  on conflict (channel_id) do update
    set price_paise = excluded.price_paise,
        enabled = excluded.enabled,
        updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.set_channel_sub_price(uuid, int, boolean) from public, anon;
grant execute on function public.set_channel_sub_price(uuid, int, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Start a purchase, at a price the server chose. Mirrors
-- create_story_purchase in every guard that matters.
-- ---------------------------------------------------------------------------
create or replace function public.create_channel_sub_purchase(
  _channel_id uuid,
  _origin text default 'web'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg channel_sub_config%rowtype;
  owner_id uuid;
  chan_name text;
  active_until timestamptz;
  new_id uuid;
  origin_clean text;
begin
  if me is null then raise exception 'not authenticated'; end if;

  select * into cfg from channel_sub_config where channel_id = _channel_id;
  if not found or not cfg.enabled then
    return jsonb_build_object('ok', false, 'reason', 'not-for-sale');
  end if;

  select c.name, m.user_id into chan_name, owner_id
    from conversations c
    join conversation_members m on m.conversation_id = c.id and m.role = 'owner'
   where c.id = _channel_id and c.type = 'channel'
   limit 1;
  if owner_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no-such-channel');
  end if;
  if owner_id = me then
    return jsonb_build_object('ok', false, 'reason', 'own-channel');
  end if;

  -- One live period at a time. Paying twice for overlapping months is a
  -- support ticket, not a feature.
  select max(period_end) into active_until
    from channel_subscriptions
   where channel_id = _channel_id and subscriber_id = me and status = 'active';
  if active_until is not null and active_until > now() + interval '7 days' then
    return jsonb_build_object('ok', false, 'reason', 'already-subscribed',
                              'periodEnd', active_until);
  end if;

  origin_clean := case when _origin = 'native-handoff' then 'native-handoff' else 'web' end;

  insert into channel_subscriptions
    (channel_id, subscriber_id, creator_id, price_paise, currency, origin)
  values (_channel_id, me, owner_id, cfg.price_paise, cfg.currency, origin_clean)
  returning id into new_id;

  return jsonb_build_object(
    'ok', true,
    'subId', new_id,
    'channelName', coalesce(chan_name, 'Channel'),
    'amountMinor', cfg.price_paise,
    'currency', cfg.currency
  );
end;
$$;
revoke all on function public.create_channel_sub_purchase(uuid, text) from public, anon;
grant execute on function public.create_channel_sub_purchase(uuid, text) to authenticated;

-- Service-role: record the Razorpay order id on the row the webhook will find.
create or replace function public.attach_channel_sub_order(
  _sub_id uuid,
  _provider_order_id text
)
returns void
language sql
security definer
set search_path = public
as $$
  update channel_subscriptions
     set provider_order_id = _provider_order_id, updated_at = now()
   where id = _sub_id and status = 'created';
$$;
revoke all on function public.attach_channel_sub_order(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The money lands. Idempotent; all three legs in one transaction.
-- ---------------------------------------------------------------------------
create or replace function public.credit_channel_subscription(
  _provider_order_id text,
  _provider_payment_id text default null,
  _confirmed_by text default 'webhook'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sub channel_subscriptions%rowtype;
  split channel_sub_split_config%rowtype;
  creator_amt int;
  cashback_amt int;
  oniq_amt int;
  chan_name text;
begin
  -- The status filter is the idempotency: a webhook retry after success
  -- matches zero rows and reports already-done rather than paying twice.
  select * into sub from channel_subscriptions
   where provider_order_id = _provider_order_id and status = 'created'
   for update;
  if not found then
    if exists (select 1 from channel_subscriptions
                where provider_order_id = _provider_order_id and status = 'active') then
      return jsonb_build_object('ok', true, 'already', true);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'no-such-purchase');
  end if;

  select * into split from channel_sub_split_config where id = true;
  if not found then raise exception 'split config missing'; end if;

  creator_amt := (sub.price_paise * split.creator_pct) / 100;
  cashback_amt := (sub.price_paise * split.cashback_pct) / 100;
  -- ONIQ takes the remainder, so rounding dust lands on the platform and the
  -- three legs always sum to the price exactly.
  oniq_amt := sub.price_paise - creator_amt - cashback_amt;

  select name into chan_name from conversations where id = sub.channel_id;

  update channel_subscriptions
     set status = 'active',
         provider_payment_id = coalesce(_provider_payment_id, provider_payment_id),
         confirmed_by = _confirmed_by,
         creator_paise = creator_amt,
         cashback_paise = cashback_amt,
         oniq_paise = oniq_amt,
         period_end = greatest(now(), coalesce((
           select max(period_end) from channel_subscriptions
            where channel_id = sub.channel_id and subscriber_id = sub.subscriber_id
              and status = 'active'
         ), now())) + interval '30 days',
         updated_at = now()
   where id = sub.id;

  -- The influencer gets paid — into their ONIQ wallet, on the ledger.
  update wallets set fiat_balance = fiat_balance + (creator_amt / 100.0), updated_at = now()
   where user_id = sub.creator_id;
  insert into transactions (recipient_id, amount, currency, type, status, note)
  values (sub.creator_id, creator_amt / 100.0, sub.currency, 'reward', 'completed',
          'Subscriber payment — ' || coalesce(chan_name, 'your channel'));

  -- The subscriber gets paid — cashback to their wallet.
  if cashback_amt > 0 then
    update wallets set fiat_balance = fiat_balance + (cashback_amt / 100.0), updated_at = now()
     where user_id = sub.subscriber_id;
    insert into transactions (recipient_id, amount, currency, type, status, note)
    values (sub.subscriber_id, cashback_amt / 100.0, sub.currency, 'reward', 'completed',
            'Subscription cashback — ' || coalesce(chan_name, 'channel'));
  end if;

  -- ONIQ gets paid: oniq_paise stays on the row; the Razorpay settlement is
  -- the platform's money and this column is its book entry.

  -- The subscriber joins the channel if they were not already in it.
  insert into conversation_members (conversation_id, user_id, role)
  values (sub.channel_id, sub.subscriber_id, 'member')
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'subId', sub.id,
                            'creatorPaise', creator_amt,
                            'cashbackPaise', cashback_amt,
                            'oniqPaise', oniq_amt);
end;
$$;
revoke all on function public.credit_channel_subscription(text, text, text) from public, anon, authenticated;

-- Service-role: the payment failed; the receipt says so.
create or replace function public.fail_channel_subscription(
  _provider_order_id text,
  _error text default 'payment failed'
)
returns void
language sql
security definer
set search_path = public
as $$
  update channel_subscriptions
     set status = 'failed', error = left(coalesce(_error, 'payment failed'), 300),
         updated_at = now()
   where provider_order_id = _provider_order_id and status = 'created';
$$;
revoke all on function public.fail_channel_subscription(text, text) from public, anon, authenticated;
