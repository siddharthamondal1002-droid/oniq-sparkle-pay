-- FINISHED VIDEO TIME — the customer unit of the in-house video product.
--
-- OWNER DIRECTIVE, 2026-08-27 (the monetization master loop). The catalogue,
-- verbatim from the owner:
--
--   * Free trial — 1 minute of finished video, ONCE PER ACCOUNT, watermark.
--   * Creator    — Rs 199/month, 30 minutes of finished video, watermark.
--   * Pro        — Rs 349/month, 60 minutes, NO watermark.
--   * Pay as you go — Rs 29 per finished minute (watermark);
--     clean export +Rs 20/min. First month free for new subscribers.
--
-- THE UNIT IS FINISHED VIDEO TIME. Never GPU seconds, never provider runtime,
-- never internal credits: a 4.041667s clip that took 52.93 billed provider
-- seconds to make costs the customer exactly 4042 milliseconds of allowance.
-- All accounting below is INTEGER milliseconds (bigint) and INTEGER paise —
-- no floating point ever touches money or entitlement.
--
-- WHY THIS IS ITS OWN LEDGER AND NOT story_allowance. The story-film product
-- sells minutes at Rs 75/min against a recorded ~Rs 31.50/min serving cost
-- (owner margin mandate, 2026-08-16). The in-house GPU clip product costs
-- ~Rs 5/min to serve, which is what makes Rs 29/min possible. One pool priced
-- two ways would let Rs 29 minutes buy Rs 31.50-cost films — a silent margin
-- inversion. So video time meters the IN-HOUSE GPU PATH ONLY, the proven
-- claim_story_seconds path is untouched, and unifying the two products is an
-- owner decision recorded as open, not an engineering default.
--
-- FAIL-CLOSED SALE SWITCH. Nothing here is on sale until the owner flips
-- video_sale_config.sales_enabled AND activates the plan rows. What IS
-- enforced immediately is the trial bound: the clip surface, free-for-all
-- under the global caps until today, becomes 60 seconds of finished video
-- per account — a strict spend REDUCTION.

-- ------------------------------------------------------------ sale config

create table if not exists public.video_sale_config (
  id boolean primary key default true check (id),
  -- Purchases (plans, PAYG, free-month starts) are refused until this is on.
  sales_enabled boolean not null default false,
  -- The 60s-per-account trial bound on generation. On from day one.
  trial_enabled boolean not null default true,
  -- Rs 29/min and +Rs 20/min clean, as integer paise. The server's numbers;
  -- a price correction is an UPDATE here, live immediately.
  payg_paise_per_minute int not null default 2900 check (payg_paise_per_minute > 0),
  clean_addon_paise_per_minute int not null default 2000
    check (clean_addon_paise_per_minute >= 0),
  updated_at timestamptz not null default now()
);

insert into public.video_sale_config (id) values (true) on conflict (id) do nothing;

alter table public.video_sale_config enable row level security;
-- No client policy at all: the flags reach clients only through
-- video_time_status(), which decides what is safe to say.

-- ------------------------------------------------------------- the catalogue

-- Video plans join the EXISTING Play-shaped catalogue as rows. Two rules keep
-- the products separate inside one table:
--   * included_seconds (story time) stays 0 on video plans, so the story
--     claim can never grant story film time against a video subscription;
--   * video_included_seconds (new, additive) stays 0 on story plans.
alter table public.subscription_plans
  add column if not exists video_included_seconds int not null default 0
    check (video_included_seconds >= 0);

-- INACTIVE ON ARRIVAL, deliberately: subscription_plans RLS shows active rows
-- only and create_plan_purchase sells active rows only, so shipping these
-- active would put them on sale before the ledger below has production proof.
-- The owner turns the catalogue on by flipping active=true together with
-- video_sale_config.sales_enabled. Display copy meanwhile lives in the TS
-- price copy (videoPricing.ts), consistency-tested against these literals.
insert into public.subscription_plans
  (key, label, kind, billing_period, price_paise, included_seconds,
   video_included_seconds, entitlements, active, sort_order)
values
  ('creator_monthly', 'Creator', 'auto_renew', 'P1M', 19900, 0, 1800, '{}', false, 13),
  ('pro_monthly', 'Pro', 'auto_renew', 'P1M', 34900, 0, 3600, '{no_watermark}', false, 14)
on conflict (key) do update
  set label = excluded.label,
      kind = excluded.kind,
      billing_period = excluded.billing_period,
      price_paise = excluded.price_paise,
      included_seconds = excluded.included_seconds,
      video_included_seconds = excluded.video_included_seconds,
      entitlements = excluded.entitlements,
      sort_order = excluded.sort_order;
      -- active is deliberately NOT updated here: once the owner turns a plan
      -- on, a re-run of this migration must not turn it back off.

-- --------------------------------------------------------- the time accounts

create table if not exists public.video_time_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- The once-per-account trial. Granted is a constant today; a column so a
  -- support adjustment is an UPDATE, not a schema change.
  trial_ms_granted bigint not null default 60000 check (trial_ms_granted >= 0),
  trial_ms_used bigint not null default 0 check (trial_ms_used >= 0),
  -- The subscription window (creator/pro). Resets when the period rolls,
  -- exactly like story_allowance.period_used_seconds does for films.
  period_start date,
  period_used_ms bigint not null default 0 check (period_used_ms >= 0),
  -- PAYG balance. No artificial expiry (owner-documented policy): purchased
  -- time stays until used.
  paid_ms bigint not null default 0 check (paid_ms >= 0),
  updated_at timestamptz not null default now()
);

alter table public.video_time_accounts enable row level security;

drop policy if exists video_time_accounts_read_own on public.video_time_accounts;
create policy video_time_accounts_read_own on public.video_time_accounts
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------- the reservations

-- One row per generation job: reserve -> settle (actual finished duration)
-- or release (nothing usable delivered, customer usage 0). The reserve
-- DEBITS the pools up front and settlement REFUNDS the unused remainder, so
-- two concurrent submissions can never jointly overspend an allowance —
-- the same debit-then-refund shape the story pipeline already trusts.
create table if not exists public.video_time_reservations (
  job_id uuid primary key references public.gpu_video_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- How the reservation was funded, pool by pool, in ms. Admin rides free:
  -- all three are zero and source says so.
  reserved_trial_ms bigint not null default 0 check (reserved_trial_ms >= 0),
  reserved_plan_ms bigint not null default 0 check (reserved_plan_ms >= 0),
  reserved_paid_ms bigint not null default 0 check (reserved_paid_ms >= 0),
  source text not null default 'pools' check (source in ('pools', 'admin')),
  status text not null default 'reserved'
    check (status in ('reserved', 'settled', 'released')),
  -- The actual finished duration charged at settlement. 0 until terminal.
  settled_ms bigint not null default 0 check (settled_ms >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists video_time_reservations_user_idx
  on public.video_time_reservations (user_id, created_at desc);

alter table public.video_time_reservations enable row level security;

drop policy if exists video_time_reservations_read_own on public.video_time_reservations;
create policy video_time_reservations_read_own on public.video_time_reservations
  for select using (auth.uid() = user_id);

-- The generation row records the watermark entitlement THE SERVER derived at
-- submit time — never a client flag. Burning the mark into clip exports is a
-- worker-side capability tracked separately; this column is the entitlement
-- of record it will read.
alter table public.gpu_video_jobs
  add column if not exists no_watermark boolean not null default false;

-- ------------------------------------------------------------ PAYG purchases

create table if not exists public.video_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  minutes int not null check (minutes between 1 and 60),
  seconds int not null check (seconds between 60 and 3600),
  price_paise int not null check (price_paise > 0),
  currency text not null default 'INR',
  status text not null default 'created'
    check (status in ('created', 'paid', 'failed', 'refunded')),
  provider text not null default 'razorpay',
  provider_order_id text unique,
  provider_payment_id text,
  origin text not null default 'web',
  error text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists video_purchases_user_idx
  on public.video_purchases (user_id, created_at desc);

alter table public.video_purchases enable row level security;

drop policy if exists video_purchases_read_own on public.video_purchases;
create policy video_purchases_read_own on public.video_purchases
  for select using (auth.uid() = user_id);

-- ------------------------------------------------------- first month free

-- ONE free month per account, EVER, across both plans — the abuse bound the
-- offer needs and nothing more. The primary key is the enforcement.
create table if not exists public.free_month_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_key text not null references public.subscription_plans(key),
  granted_at timestamptz not null default now()
);

alter table public.free_month_grants enable row level security;

drop policy if exists free_month_grants_read_own on public.free_month_grants;
create policy free_month_grants_read_own on public.free_month_grants
  for select using (auth.uid() = user_id);

-- ------------------------------------------------------------------ status

create or replace function public.video_time_status()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg public.video_sale_config%rowtype;
  acct public.video_time_accounts%rowtype;
  pk text;
  vinc bigint;
  pstart date;
  period_used bigint;
  live_reserved bigint;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into cfg from video_sale_config where id = true;

  if is_admin(me) then
    return jsonb_build_object(
      'admin', true, 'unlimited', true,
      'salesEnabled', coalesce(cfg.sales_enabled, false),
      'trialEnabled', coalesce(cfg.trial_enabled, true),
      'watermarkFree', true
    );
  end if;

  select * into acct from video_time_accounts where user_id = me;
  if not found then
    acct.trial_ms_granted := 60000; acct.trial_ms_used := 0;
    acct.period_start := null; acct.period_used_ms := 0; acct.paid_ms := 0;
  end if;

  pk := my_plan_key(me);
  select video_included_seconds::bigint * 1000 into vinc
    from subscription_plans where key = pk;
  vinc := coalesce(vinc, 0);
  pstart := allowance_period_start(me);
  period_used := case when acct.period_start is distinct from pstart
                      then 0 else acct.period_used_ms end;

  select coalesce(sum(reserved_trial_ms + reserved_plan_ms + reserved_paid_ms), 0)
    into live_reserved
    from video_time_reservations
   where user_id = me and status = 'reserved';

  return jsonb_build_object(
    'salesEnabled', coalesce(cfg.sales_enabled, false),
    'trialEnabled', coalesce(cfg.trial_enabled, true),
    'trialRemainingMs', case when coalesce(cfg.trial_enabled, true)
      then greatest(0, acct.trial_ms_granted - acct.trial_ms_used) else 0 end,
    'plan', pk,
    'planIncludedMs', vinc,
    'planRemainingMs', greatest(0, vinc - period_used),
    'paidMs', acct.paid_ms,
    'reservedMs', live_reserved,
    'watermarkFree', has_entitlement(me, 'no_watermark')
  );
end;
$$;

revoke all on function public.video_time_status() from public, anon;
grant execute on function public.video_time_status() to authenticated;

-- ----------------------------------------------------------------- reserve

-- SERVICE ROLE ONLY: the gpu-video edge function calls this after the job
-- row exists and before any provider money moves. Debit order is trial ->
-- plan window -> paid, the order in which time expires soonest. Idempotent
-- per job: a repeat for the same job returns the existing reservation and
-- debits nothing twice.
create or replace function public.reserve_video_time(
  _user uuid,
  _job_id uuid,
  _ms bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.video_sale_config%rowtype;
  acct public.video_time_accounts%rowtype;
  existing public.video_time_reservations%rowtype;
  pk text;
  vinc bigint;
  pstart date;
  period_used bigint;
  trial_avail bigint;
  plan_avail bigint;
  t_ms bigint; pl_ms bigint; pd_ms bigint;
begin
  if _user is null or _job_id is null then raise exception 'user and job required'; end if;
  if _ms is null or _ms < 1 or _ms > 600000 then raise exception 'ms out of range'; end if;

  select * into existing from video_time_reservations where job_id = _job_id;
  if found then
    return jsonb_build_object('ok', true, 'reused', true, 'status', existing.status);
  end if;

  if is_admin(_user) then
    insert into video_time_reservations (job_id, user_id, source)
    values (_job_id, _user, 'admin')
    on conflict (job_id) do nothing;
    return jsonb_build_object('ok', true, 'admin', true);
  end if;

  select * into cfg from video_sale_config where id = true;

  insert into video_time_accounts (user_id) values (_user)
  on conflict (user_id) do nothing;
  select * into acct from video_time_accounts where user_id = _user for update;

  pk := my_plan_key(_user);
  select video_included_seconds::bigint * 1000 into vinc
    from subscription_plans where key = pk;
  vinc := coalesce(vinc, 0);
  pstart := allowance_period_start(_user);
  period_used := case when acct.period_start is distinct from pstart
                      then 0 else acct.period_used_ms end;

  trial_avail := case when coalesce(cfg.trial_enabled, true)
    then greatest(0, acct.trial_ms_granted - acct.trial_ms_used) else 0 end;
  plan_avail := greatest(0, vinc - period_used);

  if trial_avail + plan_avail + acct.paid_ms < _ms then
    return jsonb_build_object('ok', false, 'reason', 'exhausted',
      'trialRemainingMs', trial_avail, 'planRemainingMs', plan_avail,
      'paidMs', acct.paid_ms, 'plan', pk);
  end if;

  t_ms := least(_ms, trial_avail);
  pl_ms := least(_ms - t_ms, plan_avail);
  pd_ms := _ms - t_ms - pl_ms;

  -- The job_id key makes a concurrent duplicate call a no-op that debits
  -- nothing: whoever loses the insert returns 'reused' with the pools intact.
  insert into video_time_reservations
    (job_id, user_id, reserved_trial_ms, reserved_plan_ms, reserved_paid_ms, source)
  values (_job_id, _user, t_ms, pl_ms, pd_ms, 'pools')
  on conflict (job_id) do nothing;
  if not found then
    return jsonb_build_object('ok', true, 'reused', true);
  end if;

  update video_time_accounts
     set trial_ms_used = trial_ms_used + t_ms,
         period_start = pstart,
         period_used_ms = period_used + pl_ms,
         paid_ms = paid_ms - pd_ms,
         updated_at = now()
   where user_id = _user;

  return jsonb_build_object('ok', true, 'reservedMs', _ms,
    'trialMs', t_ms, 'planMs', pl_ms, 'paidMs', pd_ms, 'plan', pk);
end;
$$;

revoke all on function public.reserve_video_time(uuid, uuid, bigint)
  from public, anon, authenticated;

-- ------------------------------------------------------- settle and release

-- Charge the ACTUAL finished duration and refund the rest, paid pool first
-- (the money pool is the one to protect hardest). Idempotent: a reservation
-- settles or releases exactly once; every later call is a no-op that says so.
-- The actual charge can never exceed the reservation — an artifact longer
-- than reserved is charged AT the reservation, and the anomaly is the
-- caller's to log, not the customer's to fund.
create or replace function public.settle_video_time(
  _job_id uuid,
  _actual_ms bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.video_time_reservations%rowtype;
  reserved_total bigint;
  actual bigint;
  refund bigint;
  back_paid bigint; back_plan bigint; back_trial bigint;
begin
  if _job_id is null then raise exception 'job required'; end if;

  select * into r from video_time_reservations where job_id = _job_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown-job');
  end if;
  if r.status <> 'reserved' then
    return jsonb_build_object('ok', true, 'already', r.status, 'settledMs', r.settled_ms);
  end if;

  reserved_total := r.reserved_trial_ms + r.reserved_plan_ms + r.reserved_paid_ms;
  if r.source = 'admin' then
    -- The owner rides free: nothing to charge or refund, but the RECORD is
    -- truthful — a delivered admin job settles at its measured duration.
    -- (Caught by the rolled-back production smoke, 2026-08-27: the clamp
    -- below would settle an admin delivery at 0 and mark it released.)
    actual := greatest(coalesce(_actual_ms, 0), 0);
    refund := 0;
  else
    actual := least(greatest(coalesce(_actual_ms, 0), 0), reserved_total);
    refund := reserved_total - actual;
  end if;

  back_paid := least(refund, r.reserved_paid_ms);
  back_plan := least(refund - back_paid, r.reserved_plan_ms);
  back_trial := refund - back_paid - back_plan;

  if r.source = 'pools' and refund > 0 then
    update video_time_accounts
       set paid_ms = paid_ms + back_paid,
           period_used_ms = greatest(0, period_used_ms - back_plan),
           trial_ms_used = greatest(0, trial_ms_used - back_trial),
           updated_at = now()
     where user_id = r.user_id;
  end if;

  update video_time_reservations
     set status = case when actual > 0 then 'settled' else 'released' end,
         settled_ms = actual,
         updated_at = now()
   where job_id = _job_id;

  return jsonb_build_object('ok', true, 'settledMs', actual, 'refundedMs', refund);
end;
$$;

revoke all on function public.settle_video_time(uuid, bigint)
  from public, anon, authenticated;

-- A failed generation charges nothing: the whole reservation goes back.
create or replace function public.release_video_time(_job_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.settle_video_time(_job_id, 0);
$$;

revoke all on function public.release_video_time(uuid)
  from public, anon, authenticated;

-- ------------------------------------------------------------ PAYG purchase

-- INTENT ONLY, like every product on the rail: the row exists before the
-- Razorpay order, the price is the server's rate times the minutes, and
-- credit_video_purchase — service role only — is what moves the balance
-- once money has actually moved.
create or replace function public.create_video_purchase(
  _minutes int,
  _origin text default 'web'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg public.video_sale_config%rowtype;
  price int;
  pid uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into cfg from video_sale_config where id = true;
  if not found or cfg.sales_enabled is not true then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;
  if _minutes is null or _minutes not in (1, 2, 5, 10) then
    return jsonb_build_object('ok', false, 'reason', 'no-such-tier');
  end if;

  price := cfg.payg_paise_per_minute * _minutes;

  insert into video_purchases (user_id, minutes, seconds, price_paise, origin)
  values (me, _minutes, _minutes * 60, price,
          case when _origin = 'native-handoff' then 'native-handoff' else 'web' end)
  returning id into pid;

  return jsonb_build_object('ok', true, 'purchaseId', pid,
    'minutes', _minutes, 'seconds', _minutes * 60,
    'label', _minutes || ' min of video time',
    'amountMinor', price, 'currency', 'INR');
end;
$$;

revoke all on function public.create_video_purchase(int, text) from public, anon;
grant execute on function public.create_video_purchase(int, text) to authenticated;

create or replace function public.attach_video_purchase_order(
  _purchase_id uuid,
  _provider_order_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update video_purchases
     set provider_order_id = _provider_order_id, updated_at = now()
   where id = _purchase_id and status = 'created' and provider_order_id is null;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not-attachable');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.attach_video_purchase_order(uuid, text)
  from public, anon, authenticated;

-- Mirrors credit_story_purchase line for line: found by provider order id,
-- locked, and a row already paid credits NOTHING twice — that single guard is
-- what makes a duplicate webhook, a webhook-plus-verify race, and a Razorpay
-- retry all safe.
create or replace function public.credit_video_purchase(
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
  p public.video_purchases%rowtype;
begin
  if _provider_order_id is null or length(trim(_provider_order_id)) = 0 then
    raise exception 'provider order id required';
  end if;

  select * into p from video_purchases
   where provider_order_id = _provider_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown-order');
  end if;

  if p.status = 'paid' then
    return jsonb_build_object('ok', true, 'alreadyPaid', true,
                              'seconds', p.seconds, 'userId', p.user_id);
  end if;

  insert into video_time_accounts (user_id) values (p.user_id)
  on conflict (user_id) do nothing;
  update video_time_accounts
     set paid_ms = paid_ms + p.seconds::bigint * 1000, updated_at = now()
   where user_id = p.user_id;

  update video_purchases
     set status = 'paid',
         provider_payment_id = coalesce(_provider_payment_id, provider_payment_id),
         paid_at = now(),
         error = null,
         updated_at = now()
   where id = p.id;

  return jsonb_build_object('ok', true, 'seconds', p.seconds, 'userId', p.user_id,
                            'confirmedBy', _confirmed_by);
end;
$$;

revoke all on function public.credit_video_purchase(text, text, text)
  from public, anon, authenticated;

-- A paid row is never walked back by a late payment.failed event — same rule
-- as every other product on the rail.
create or replace function public.fail_video_purchase(
  _provider_order_id text,
  _error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update video_purchases
     set status = 'failed', error = left(coalesce(_error, 'payment failed'), 200),
         updated_at = now()
   where provider_order_id = _provider_order_id and status = 'created';
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.fail_video_purchase(text, text)
  from public, anon, authenticated;

-- -------------------------------------------------------- first month free

-- NEW SUBSCRIBERS ONLY, once per account, and only while the catalogue is on
-- sale. Grants one real month through the same grant_subscription every paid
-- month uses, so entitlement, renewal date and cancellation behave exactly
-- like a paid month — the only difference is that no order exists.
create or replace function public.start_free_video_month(_plan_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg public.video_sale_config%rowtype;
  p public.subscription_plans%rowtype;
  granted jsonb;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into cfg from video_sale_config where id = true;
  if not found or cfg.sales_enabled is not true then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;

  select * into p from subscription_plans
   where key = _plan_key and kind = 'auto_renew' and active
     and key in ('creator_monthly', 'pro_monthly');
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no-such-plan');
  end if;

  if exists (select 1 from subscriptions s
              where s.user_id = me and s.status in ('active', 'grace')
                and s.period_end > (now() at time zone 'utc')::date) then
    return jsonb_build_object('ok', false, 'reason', 'already-subscribed');
  end if;

  -- The primary key IS the once-ever bound.
  insert into free_month_grants (user_id, plan_key) values (me, _plan_key)
  on conflict (user_id) do nothing;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'already-used');
  end if;

  granted := grant_subscription(me, _plan_key, 1, 'oniq', 'first-month-free');

  return jsonb_build_object('ok', true, 'plan', p.key, 'label', p.label,
    'renewsOn', granted->>'periodEnd',
    'thenPaise', p.price_paise);
end;
$$;

revoke all on function public.start_free_video_month(text) from public, anon;
grant execute on function public.start_free_video_month(text) to authenticated;

-- ------------------------------------------------------ internal cost view

-- COGS per finished minute, operator eyes only: reads the per-job actuals the
-- gpu path already records. Access via service role / SQL only — no grant, no
-- policy, and the customer-facing surfaces never see provider numbers.
create or replace view public.gpu_video_cogs
with (security_invoker = true) as
select
  id, created_at, status,
  video_seconds,
  billed_seconds, audio_billed_seconds,
  actual_cost_usd, audio_cost_usd,
  case when coalesce(video_seconds, 0) > 0
       then (coalesce(actual_cost_usd, 0) + coalesce(audio_cost_usd, 0))
            / (video_seconds / 60.0)
       end as cogs_usd_per_finished_minute
from public.gpu_video_jobs;

-- security_invoker means the base table's admin-only RLS decides who sees
-- rows; the revoke below is the second lock on the same door.
revoke all on public.gpu_video_cogs from public, anon, authenticated;

comment on table public.video_time_accounts is
  'Finished-video-time balances per user: once-per-account trial, subscription window, PAYG. Integer milliseconds only.';
comment on table public.video_time_reservations is
  'One row per generation job: debit-at-reserve, refund-at-settle. settle_video_time charges the actual finished duration.';
comment on table public.video_purchases is
  'PAYG purchases of finished video time. Intent rows; credit_video_purchase moves the balance once payment is captured.';
comment on table public.free_month_grants is
  'First-month-free redemptions — the primary key is the once-per-account bound.';
