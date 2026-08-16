-- STORY TIME BECOMES A MONTHLY PLAN.
--
-- OWNER DIRECTIVE, 2026-08-16. Asked to move off per-second selling to a
-- per-month model, after being shown that the per-minute chart nets 11.2%
-- against a 26% mandate and has sold nothing in six days of being open.
-- The decisions, all the owner's, taken against costed options:
--
--   * ONIQ Plus — Rs 499 a month, 8 minutes of film included, plus the
--     things that cost nothing to serve (no watermark, the full lens rack).
--   * Free plan — 1 minute a month, replacing the old 300-seconds-for-life.
--   * Per-minute top-ups SURVIVE as a prepaid plan rather than being
--     deleted, for people who will not commit monthly and for subscribers
--     who run out mid-month.
--
-- WHY 8 MINUTES AND NOT MORE. A minute of movie-grade film costs Rs 37.55 to
-- generate, so an included minute is a real cost, not a marketing number. At
-- Rs 499 the break-even is 10.5 minutes: a subscriber who uses more than that
-- costs more than they pay. 8 leaves headroom for the flat per-film
-- infrastructure and for the plan to stay profitable at full use — which is
-- the only assumption worth designing to, because the subscribers who use
-- everything are exactly the ones who stay.
--
-- THE SHAPE IS GOOGLE PLAY'S, DELIBERATELY. Play models a subscription as one
-- product holding several BASE PLANS (monthly auto-renew, annual auto-renew,
-- prepaid) and offers hanging off each. This schema mirrors that: `free`,
-- `plus_monthly` and `topup` are three base plans of one product, and an
-- annual plan or a free-trial offer is a row rather than a migration. ONIQ
-- bills through Razorpay today, so none of this is Play's tooling — but if
-- the billing ever moves, the mapping is one-to-one instead of a rewrite.
--
-- WHAT IS NOT HERE. No payment wiring. The rail has never carried a completed
-- transaction — one order was opened on 10 August and died before capture —
-- and a subscription is a worse thing to debug on an unproven rail than a
-- one-off. Everything below is the model, the allowance arithmetic and the
-- entitlements, all of which are testable without money moving. Subscribing
-- is granted by a definer RPC that the checkout will call once the rail is
-- proven; until then only an admin can grant one.

-- ---------------------------------------------------------------- base plans

create table if not exists public.subscription_plans (
  key text primary key,
  label text not null,
  -- 'free' is the plan with no purchase behind it; 'auto_renew' recurs;
  -- 'prepaid' is bought a lump at a time and does not renew. Play's three.
  kind text not null check (kind in ('free', 'auto_renew', 'prepaid')),
  -- ISO 8601 duration, as Play writes it. Null for free and prepaid.
  billing_period text check (billing_period is null or billing_period in ('P1M', 'P3M', 'P1Y')),
  price_paise int not null default 0 check (price_paise >= 0),
  -- Seconds of film granted at the start of each period. Prepaid grants
  -- nothing here — its seconds arrive as a paid_seconds balance instead.
  included_seconds int not null default 0 check (included_seconds >= 0),
  -- Everything that costs nothing to serve. Kept as a set rather than a
  -- column per feature so adding one is a data change.
  entitlements text[] not null default '{}',
  active boolean not null default true,
  sort_order int not null default 0
);

insert into public.subscription_plans
  (key, label, kind, billing_period, price_paise, included_seconds, entitlements, active, sort_order)
values
  ('free', 'Free', 'free', null, 0, 60, '{}', true, 0),
  ('plus_monthly', 'ONIQ Plus', 'auto_renew', 'P1M', 49900, 480,
   '{no_watermark,all_lenses,group_calls}', true, 10),
  -- Prices for this one live in story_price_tiers, which is already the
  -- audited chart. The row exists so the prepaid path is visible as a base
  -- plan of the same product rather than as a separate concept.
  ('topup', 'Top up', 'prepaid', null, 0, 0, '{}', true, 20)
on conflict (key) do update
  set label = excluded.label,
      kind = excluded.kind,
      billing_period = excluded.billing_period,
      price_paise = excluded.price_paise,
      included_seconds = excluded.included_seconds,
      entitlements = excluded.entitlements,
      active = excluded.active,
      sort_order = excluded.sort_order;

alter table public.subscription_plans enable row level security;

drop policy if exists subscription_plans_read on public.subscription_plans;
create policy subscription_plans_read on public.subscription_plans
  for select using (active);

-- --------------------------------------------------------------- who is on what

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_key text not null references public.subscription_plans(key),
  -- 'grace' and 'on_hold' are Play's involuntary-churn states and the course's
  -- recommendation: a failed payment gives the subscriber days to fix their
  -- card with access intact (grace), then suspends access without cancelling
  -- (hold), rather than deleting a paying customer over a bank timeout.
  status text not null check (status in ('active', 'grace', 'on_hold', 'canceled', 'expired')),
  period_start date not null,
  period_end date not null,
  -- A cancellation takes effect at the end of the paid period, never on the
  -- day it is pressed. Somebody who paid for the month keeps the month.
  cancel_at_period_end boolean not null default false,
  provider text,
  provider_sub_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_period_ordered check (period_end > period_start)
);

create index if not exists subscriptions_status_idx on public.subscriptions (status, period_end);

alter table public.subscriptions enable row level security;

-- SELECT ONLY, and only your own. Every write goes through a definer function
-- below, the same rule story_jobs runs: this table decides who has paid, so a
-- client-writable path into it is a client-writable path into the entitlement.
drop policy if exists subscriptions_read_own on public.subscriptions;
create policy subscriptions_read_own on public.subscriptions
  for select using (auth.uid() = user_id);

-- --------------------------------------------------- monthly allowance columns

-- The old model gave 300 seconds ONCE, for life, and never reset. A monthly
-- plan needs a window, so the allowance grows one. free_seconds/used_seconds
-- are left in place and no longer gate anything: they are the lifetime
-- counters, still worth having, and dropping columns other code may read is a
-- separate and riskier change than ignoring them.
alter table public.story_allowance
  add column if not exists period_start date,
  add column if not exists period_used_seconds int not null default 0;

-- ------------------------------------------------------------------- helpers

-- The plan a user is actually on, right now.
--
-- 'grace' counts as subscribed on purpose: that is the entire point of a grace
-- period. 'on_hold' does not — access is suspended until the card is fixed.
-- An expired period falls back to free without needing a sweep to have run,
-- so a late cron can never hand somebody a month they did not pay for.
create or replace function public.my_plan_key(_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.plan_key
       from subscriptions s
      where s.user_id = _user
        and s.status in ('active', 'grace')
        and s.period_end > (now() at time zone 'utc')::date
      limit 1),
    'free'
  );
$$;

-- When the current allowance window opened.
--
-- Subscribers reset on their own billing date, not on the 1st — otherwise
-- somebody subscribing on the 28th would get a fresh 8 minutes three days
-- later. Everyone else resets with the calendar month.
create or replace function public.allowance_period_start(_user uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.period_start
       from subscriptions s
      where s.user_id = _user
        and s.status in ('active', 'grace')
        and s.period_end > (now() at time zone 'utc')::date
      limit 1),
    date_trunc('month', (now() at time zone 'utc'))::date
  );
$$;

-- Does this user have a named benefit?
--
-- The owner rides free (2026-08-12) and therefore holds every entitlement;
-- that rule lives here rather than at each call site so a new benefit cannot
-- forget it.
create or replace function public.has_entitlement(_user uuid, _key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_admin(_user) or exists (
    select 1 from subscription_plans p
     where p.key = my_plan_key(_user)
       and _key = any(p.entitlements)
  );
$$;

revoke all on function public.my_plan_key(uuid) from public, anon;
revoke all on function public.allowance_period_start(uuid) from public, anon;
revoke all on function public.has_entitlement(uuid, text) from public, anon;
grant execute on function public.my_plan_key(uuid) to authenticated;
grant execute on function public.allowance_period_start(uuid) to authenticated;
grant execute on function public.has_entitlement(uuid, text) to authenticated;

-- ------------------------------------------------------- granting a plan

-- Put a user on a plan for one period.
--
-- DEFINER AND NOT REACHABLE BY THE CLIENT. This is the function that decides
-- who has paid; it is granted to nobody and called by the checkout's service
-- role once a payment is captured, or by an admin. Granting it to
-- `authenticated` would make the subscription free for anyone who can read
-- the network tab.
create or replace function public.grant_subscription(
  _user uuid,
  _plan_key text,
  _months int default 1,
  _provider text default null,
  _provider_sub_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.subscription_plans%rowtype;
  starts date := (now() at time zone 'utc')::date;
  ends date;
  existing public.subscriptions%rowtype;
begin
  if _months is null or _months < 1 or _months > 12 then
    raise exception 'months out of range';
  end if;

  select * into p from subscription_plans where key = _plan_key and active;
  if not found then raise exception 'no such plan'; end if;
  if p.kind <> 'auto_renew' then raise exception 'plan is not subscribable'; end if;

  -- RENEWING EXTENDS, IT DOES NOT RESTART. Someone paying on day 20 of a paid
  -- month keeps the ten days they already have; restarting the period here
  -- would silently take them away and reset the minute allowance early.
  select * into existing from subscriptions where user_id = _user for update;
  if found and existing.status in ('active', 'grace') and existing.period_end > starts then
    starts := existing.period_start;
    ends := (existing.period_end + (_months || ' months')::interval)::date;
  else
    ends := (starts + (_months || ' months')::interval)::date;
  end if;

  insert into subscriptions as s
    (user_id, plan_key, status, period_start, period_end, cancel_at_period_end,
     provider, provider_sub_id, updated_at)
  values
    (_user, p.key, 'active', starts, ends, false, _provider, _provider_sub_id, now())
  on conflict (user_id) do update
    set plan_key = excluded.plan_key,
        status = 'active',
        period_start = excluded.period_start,
        period_end = excluded.period_end,
        cancel_at_period_end = false,
        provider = coalesce(excluded.provider, s.provider),
        provider_sub_id = coalesce(excluded.provider_sub_id, s.provider_sub_id),
        updated_at = now();

  return jsonb_build_object('ok', true, 'plan', p.key,
                            'periodStart', starts, 'periodEnd', ends);
end;
$$;

revoke all on function public.grant_subscription(uuid, text, int, text, text) from public, anon, authenticated;

-- Cancel — at the end of the period, never immediately.
create or replace function public.cancel_my_subscription()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  s public.subscriptions%rowtype;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into s from subscriptions where user_id = me for update;
  if not found or s.status not in ('active', 'grace') then
    return jsonb_build_object('ok', true, 'alreadyOff', true);
  end if;
  update subscriptions
     set cancel_at_period_end = true, updated_at = now()
   where user_id = me;
  -- The period is NOT shortened. They keep what they paid for, which is both
  -- the honest answer and the one Play's policy expects.
  return jsonb_build_object('ok', true, 'accessUntil', s.period_end);
end;
$$;

revoke all on function public.cancel_my_subscription() from public, anon;
grant execute on function public.cancel_my_subscription() to authenticated;

comment on table public.subscription_plans is
  'Base plans of one subscription product, shaped after Google Play (free / auto_renew / prepaid). included_seconds is granted per period; entitlements are the zero-marginal-cost benefits.';
comment on table public.subscriptions is
  'Who is on which base plan, and until when. SELECT-own only; every write goes through grant_subscription or cancel_my_subscription.';
