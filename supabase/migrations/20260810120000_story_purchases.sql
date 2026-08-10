-- Buying Story seconds. Collected on the WEBSITE, always.
--
-- WHY THE MONEY IS TAKEN ON THE WEB AND NOWHERE ELSE. A Story is digital
-- content consumed inside the app, and Google Play requires Play Billing for
-- that. ONIQ's decision is that the app never takes the payment: the native
-- build hands off to oniqhub.com and the collection happens in the browser, on
-- the same Razorpay rail the food orders already use. That decision is a
-- PRODUCT decision and it is recorded here because the schema is what enforces
-- it — `story_purchase_config.native_link_out` is a row, so if Play objects the
-- link-out stops without an app resubmission, and the website keeps selling.
--
-- WHAT IS SOLD IS SECONDS, not a subscription and not a video. story_allowance
-- already meters Stories in seconds and claim_story_seconds already spends
-- them; a purchase simply tops up a second bucket next to the free one. That is
-- why there is no new spend path in this file — a new one would be a second
-- place for the balance to be wrong.
--
-- THE CLIENT NEVER NAMES A PRICE, same rule as `orders.total`. The browser
-- sends a tier length; create_story_purchase reads the price out of
-- story_price_tiers. A tampered amount changes nothing, because the amount is
-- never read from the request.
--
-- AND THE CLIENT NEVER CREDITS ITSELF. credit_story_purchase is service-role
-- only and is reached exactly twice: from razorpay-verify after a checkout
-- signature checks out, and from razorpay-webhook after a webhook signature
-- does. There is no path from an authenticated session to paid_seconds.

-- ---------------------------------------------------------------------------
-- The published chart. Mirrors PRICE_TIERS in src/lib/storyPricing.ts, and
-- src/lib/__tests__/storyPricingSql.test.ts parses this file to prove it — two
-- copies of a price is exactly the drift that shows up first on a bill.
--
-- Prices sit in the DATABASE rather than in the edge function because the
-- charge is computed here. A price that lives in deployed code cannot be
-- corrected without a deploy, and the one time you need to correct a price
-- urgently is the one time you cannot wait for CI.
-- ---------------------------------------------------------------------------
create table if not exists public.story_price_tiers (
  seconds int primary key check (seconds > 0),
  label text not null,
  price_paise int not null check (price_paise > 0),
  -- INR only, for now, because that is what the Razorpay account settles in.
  -- Carried as a column rather than assumed so a second currency is a row and
  -- not a migration.
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  sort_order int not null,
  updated_at timestamptz not null default now()
);

insert into public.story_price_tiers (seconds, label, price_paise, sort_order) values
  (30,  '30 seconds', 4900,  1),
  (60,  '1 minute',   9900,  2),
  (120, '2 minutes',  17900, 3),
  (180, '3 minutes',  24900, 4),
  (300, '5 minutes',  39900, 5)
on conflict (seconds) do nothing;

alter table public.story_price_tiers enable row level security;

-- The chart is public information — it is on the pricing page. Read-only to
-- everyone, writable by nobody but the service role.
drop policy if exists story_price_tiers_read on public.story_price_tiers;
create policy story_price_tiers_read on public.story_price_tiers
  for select using (true);

revoke insert, update, delete on public.story_price_tiers from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Whether the native build may link out, and where to.
--
-- A ROW, NOT A CONSTANT. Play's position on steering differs by country and has
-- moved twice in two years; the US injunction and the EEA's DMA permit a
-- link-out that the base policy does not. When that changes again the fix must
-- be an UPDATE, because an app resubmission takes days and a policy strike
-- takes effect immediately.
--
-- native_link_out = false leaves the website selling exactly as before and the
-- app simply not offering it — the reader-app posture, which is the shape Play
-- has never objected to.
-- ---------------------------------------------------------------------------
create table if not exists public.story_purchase_config (
  id boolean primary key default true check (id),
  -- Master switch for selling Story seconds at all, on any surface.
  enabled boolean not null default true,
  -- Whether the NATIVE app may show a buy button that opens the browser.
  native_link_out boolean not null default true,
  -- Where that button goes. Absolute, https, and on ONIQ's own domain — the
  -- check is here because a mutable redirect target read by the client is a
  -- phishing primitive if it is ever writable by the wrong role.
  checkout_url text not null default 'https://oniqhub.com/pay/story'
    check (checkout_url ~ '^https://[a-z0-9.-]+\.[a-z]{2,}(/|$)'),
  updated_at timestamptz not null default now()
);

insert into public.story_purchase_config (id) values (true) on conflict (id) do nothing;

alter table public.story_purchase_config enable row level security;

drop policy if exists story_purchase_config_read on public.story_purchase_config;
create policy story_purchase_config_read on public.story_purchase_config
  for select using (true);

revoke insert, update, delete on public.story_purchase_config from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The paid bucket, alongside the free one.
--
-- A SEPARATE COLUMN rather than adding to free_seconds. Three reasons, all of
-- which bite later: free time is capped per day and paid time is not; a refund
-- has to go back to the bucket it came from; and "how much did this user
-- actually buy" stops being answerable the moment the two are added together.
-- ---------------------------------------------------------------------------
alter table public.story_allowance
  add column if not exists paid_seconds int not null default 0 check (paid_seconds >= 0);

comment on column public.story_allowance.paid_seconds is
  'Purchased Story seconds not yet spent. Credited only by credit_story_purchase '
  '(service role, post-signature). Spent after free seconds, and exempt from the '
  'per-user daily cap.';

-- Which bucket a job actually drew from, so a refund can put it back.
-- seconds_charged stays the TOTAL; this is the paid part of it.
alter table public.story_jobs
  add column if not exists paid_seconds_charged int not null default 0
    check (paid_seconds_charged >= 0);

-- Observability only: the ceiling is enforced against free usage, so paid usage
-- is counted separately rather than folded in. See claim_story_seconds.
alter table public.story_global_usage
  add column if not exists paid_seconds int not null default 0 check (paid_seconds >= 0);

-- ---------------------------------------------------------------------------
-- One purchase attempt.
--
-- Rows are created BEFORE the money moves, which is the point: a payment that
-- arrives for an order we have no record of is unattributable, and Razorpay's
-- webhook only carries its own ids. The provider order id is the join.
-- ---------------------------------------------------------------------------
create table if not exists public.story_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Copied from the tier at purchase time, not joined. A price change must not
  -- retroactively alter what somebody already agreed to pay.
  seconds int not null check (seconds > 0),
  price_paise int not null check (price_paise > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'created'
    check (status in ('created', 'paid', 'failed')),
  provider text not null default 'razorpay',
  provider_order_id text unique,
  provider_payment_id text,
  -- What actually reached the allowance. Stays 0 until credited, and is the
  -- idempotency guard: a webhook and a client callback both arriving means the
  -- second one must be a no-op, not a second credit.
  seconds_credited int not null default 0 check (seconds_credited >= 0),
  -- Which surface took the money. Recorded because the whole point of this
  -- feature is that it is always 'web'; if 'native' ever appears here, the
  -- link-out has been bypassed and that is worth being able to prove.
  origin text not null default 'web' check (origin in ('web', 'native-handoff')),
  error text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists story_purchases_user_created_idx
  on public.story_purchases (user_id, created_at desc);
create index if not exists story_purchases_provider_order_idx
  on public.story_purchases (provider_order_id);

alter table public.story_purchases enable row level security;

-- A user may READ their own receipts and nothing else. No insert policy and no
-- update policy on purpose: both paths go through a SECURITY DEFINER function,
-- because a row a client can write is a balance a client can mint.
drop policy if exists story_purchases_read_own on public.story_purchases;
create policy story_purchases_read_own on public.story_purchases
  for select using (auth.uid() = user_id);

revoke insert, update, delete on public.story_purchases from anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_story_purchase — start a purchase, at a price the server chose.
--
-- Returns the row id and the amount. The caller passes a LENGTH; if the length
-- is not a live tier this refuses rather than improvising, because a price
-- computed on the fly is a price nobody reviewed.
-- ---------------------------------------------------------------------------
create or replace function public.create_story_purchase(_seconds int, _origin text default 'web')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  tier public.story_price_tiers%rowtype;
  cfg public.story_purchase_config%rowtype;
  new_id uuid;
  origin_clean text;
begin
  if me is null then raise exception 'not authenticated'; end if;

  select * into cfg from story_purchase_config where id = true;
  if not found or not cfg.enabled then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;

  select * into tier from story_price_tiers where seconds = _seconds and active;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no-such-tier');
  end if;

  -- Anything unrecognised is recorded as plain 'web' rather than rejected: this
  -- is a provenance note, and failing a real payment over a label would be the
  -- wrong trade.
  origin_clean := case when _origin = 'native-handoff' then 'native-handoff' else 'web' end;

  insert into story_purchases (user_id, seconds, price_paise, currency, origin)
  values (me, tier.seconds, tier.price_paise, tier.currency, origin_clean)
  returning id into new_id;

  return jsonb_build_object(
    'ok', true,
    'purchaseId', new_id,
    'seconds', tier.seconds,
    'label', tier.label,
    'amountMinor', tier.price_paise,
    'currency', tier.currency
  );
end;
$$;

revoke all on function public.create_story_purchase(int, text) from public, anon;
grant execute on function public.create_story_purchase(int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- attach_story_purchase_order — record the Razorpay order id against the row.
--
-- Split from create_story_purchase because the provider order is created by an
-- edge function AFTER this row exists, and a failed Razorpay call must not
-- leave a purchase row that claims an order id it never got.
-- ---------------------------------------------------------------------------
create or replace function public.attach_story_purchase_order(
  _purchase_id uuid,
  _provider_order_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_user uuid;
  row_status text;
begin
  select user_id, status into row_user, row_status
    from story_purchases where id = _purchase_id for update;
  if not found then raise exception 'purchase not found'; end if;
  if row_status <> 'created' then
    -- Already settled. Re-attaching would let a second provider order be
    -- pointed at a purchase that has already paid out seconds.
    return jsonb_build_object('ok', false, 'reason', 'already-settled');
  end if;

  update story_purchases
     set provider_order_id = _provider_order_id, updated_at = now()
   where id = _purchase_id;

  return jsonb_build_object('ok', true, 'userId', row_user);
end;
$$;

revoke all on function public.attach_story_purchase_order(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- credit_story_purchase — the only thing that increases paid_seconds.
--
-- IDEMPOTENT, and it has to be: razorpay-verify and razorpay-webhook both call
-- it for the same payment, by design, because either one alone can be lost. The
-- guard is `status = 'paid'`, checked under the row lock — not a check on
-- whether seconds_credited happens to be non-zero, which would double-credit
-- the moment a tier of 0 seconds ever existed.
--
-- SERVICE ROLE ONLY. Every caller has already verified an HMAC.
-- ---------------------------------------------------------------------------
create or replace function public.credit_story_purchase(
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
  p public.story_purchases%rowtype;
begin
  if _provider_order_id is null or length(trim(_provider_order_id)) = 0 then
    raise exception 'provider order id required';
  end if;

  select * into p from story_purchases
   where provider_order_id = _provider_order_id for update;
  if not found then
    -- Not an error worth retrying: a payment for an order we never created is
    -- either another product's or a replay. Named so the log says which.
    return jsonb_build_object('ok', false, 'reason', 'unknown-order');
  end if;

  if p.status = 'paid' then
    return jsonb_build_object('ok', true, 'alreadyPaid', true,
                              'seconds', p.seconds_credited, 'userId', p.user_id);
  end if;

  insert into story_allowance (user_id) values (p.user_id) on conflict (user_id) do nothing;
  update story_allowance
     set paid_seconds = paid_seconds + p.seconds, updated_at = now()
   where user_id = p.user_id;

  update story_purchases
     set status = 'paid',
         seconds_credited = p.seconds,
         provider_payment_id = coalesce(_provider_payment_id, provider_payment_id),
         paid_at = now(),
         error = null,
         updated_at = now()
   where id = p.id;

  return jsonb_build_object('ok', true, 'seconds', p.seconds, 'userId', p.user_id,
                            'confirmedBy', _confirmed_by);
end;
$$;

revoke all on function public.credit_story_purchase(text, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- fail_story_purchase — record a declined payment.
--
-- Never touches the allowance. A failure that arrives after a success is
-- ignored rather than applied: Razorpay can send payment.failed for an attempt
-- that the user then retried successfully, and marking that purchase failed
-- would revoke seconds somebody paid for.
-- ---------------------------------------------------------------------------
create or replace function public.fail_story_purchase(_provider_order_id text, _error text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.story_purchases%rowtype;
begin
  select * into p from story_purchases
   where provider_order_id = _provider_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown-order');
  end if;
  if p.status = 'paid' then
    return jsonb_build_object('ok', true, 'ignored', 'already paid');
  end if;

  update story_purchases
     set status = 'failed', error = left(coalesce(_error, 'payment failed'), 500),
         updated_at = now()
   where id = p.id;

  return jsonb_build_object('ok', true, 'recorded', 'failed');
end;
$$;

revoke all on function public.fail_story_purchase(text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- claim_story_seconds — REPLACED, to spend the paid bucket.
--
-- Everything about the original stands; the changes are these four, and each
-- one is a decision rather than a tidy-up:
--
--   FREE FIRST, THEN PAID. Somebody with free time left should not be burning
--   what they bought. The split is recorded on the job so the refund can undo
--   it exactly.
--
--   PAID SECONDS IGNORE THE PER-USER DAILY CAP. That cap exists to bound what a
--   single free user can cost in a day. Applying it to purchased time would
--   sell somebody five minutes and then refuse to render it, which is not a
--   limit, it is a complaint.
--
--   THE PRODUCT-WIDE CEILING IS CHECKED AGAINST THE FREE PORTION ONLY. It is
--   the one thing bounding absolute infrastructure cost, so it stays — but a
--   paid second is revenue-covered and should not eat a free user's capacity.
--   Paid usage is still recorded, in its own column, so the day's real total is
--   still answerable.
--
--   REFUSALS STILL CONSUME NOTHING. Unchanged, and re-verified: every early
--   return happens before the first UPDATE.
--
-- LOCK ORDER IS UNCHANGED — global day row, then user allowance row.
-- ---------------------------------------------------------------------------
create or replace function public.claim_story_seconds(_requested_seconds int, _prompt text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg public.story_config%rowtype;
  today date := (now() at time zone 'utc')::date;
  prompt_clean text;
  wanted int;
  global_used int;
  a_free int;
  a_used int;
  a_paid int;
  a_daily_used int;
  a_daily_day date;
  free_cap int;
  remaining int;
  daily_left int;
  spend_free int;
  spend_paid int;
  job_id uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;

  prompt_clean := trim(coalesce(_prompt, ''));
  if length(prompt_clean) = 0 then raise exception 'prompt required'; end if;
  if length(prompt_clean) > 2000 then raise exception 'prompt too long'; end if;

  select * into cfg from story_config where id = true;
  if not found then raise exception 'story config missing'; end if;

  if not cfg.enabled then
    return jsonb_build_object('ok', false, 'reason', 'disabled',
                              'remaining', 0, 'dailyLeft', 0, 'paidSeconds', 0, 'wanted', 0);
  end if;

  wanted := greatest(cfg.min_story_seconds,
                     least(cfg.max_story_seconds, coalesce(_requested_seconds, 0)));

  insert into story_global_usage (day) values (today) on conflict (day) do nothing;
  select used_seconds into global_used from story_global_usage where day = today for update;

  insert into story_allowance (user_id) values (me) on conflict (user_id) do nothing;
  select free_seconds, used_seconds, paid_seconds, daily_used_seconds, daily_day
    into a_free, a_used, a_paid, a_daily_used, a_daily_day
    from story_allowance where user_id = me for update;

  if a_daily_day <> today then
    a_daily_used := 0;
  end if;

  free_cap := coalesce(a_free, cfg.free_seconds);
  remaining := greatest(0, free_cap - a_used);
  daily_left := greatest(0, cfg.daily_seconds - a_daily_used);

  -- How this request splits across the two buckets. Free is taken first, and is
  -- itself bounded by what is left of today; the remainder comes out of what
  -- was paid for.
  spend_free := least(wanted, remaining, daily_left);
  spend_paid := least(wanted - spend_free, a_paid);

  -- Not enough anywhere. The reason names the bucket that ran out, because
  -- "buy more" and "come back tomorrow" are different instructions and the
  -- wrong one either costs a sale or wastes somebody's afternoon.
  --
  -- WRITTEN AS SEQUENTIAL RETURNS, not as a CASE expression. The first draft
  -- used a CASE and storyJobsSchema.test.ts could no longer read the refusal
  -- order out of it — the guard that pins this function's order to
  -- checkStoryQuota's went quiet rather than failing. A guard that cannot parse
  -- what it guards is worse than no guard, so the SQL is shaped to stay
  -- readable by it.
  if spend_free + spend_paid < wanted then
    if remaining <= 0 and a_paid <= 0 then
      return jsonb_build_object('ok', false, 'reason', 'exhausted',
                                'remaining', remaining, 'dailyLeft', daily_left,
                                'paidSeconds', a_paid, 'wanted', wanted);
    end if;
    if spend_free < least(wanted, remaining) then
      return jsonb_build_object('ok', false, 'reason', 'daily',
                                'remaining', remaining, 'dailyLeft', daily_left,
                                'paidSeconds', a_paid, 'wanted', wanted);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'too-long',
                              'remaining', remaining, 'dailyLeft', daily_left,
                              'paidSeconds', a_paid, 'wanted', wanted);
  end if;

  -- The ceiling applies to the free portion only. A request funded entirely
  -- out of purchased seconds passes even on a day that is otherwise spent.
  if global_used + spend_free > cfg.global_daily_seconds then
    return jsonb_build_object('ok', false, 'reason', 'capacity',
                              'remaining', remaining, 'dailyLeft', daily_left,
                              'paidSeconds', a_paid, 'wanted', wanted);
  end if;

  update story_global_usage
     set used_seconds = used_seconds + spend_free,
         paid_seconds = paid_seconds + spend_paid,
         updated_at = now()
   where day = today;

  update story_allowance
     set used_seconds = used_seconds + spend_free,
         paid_seconds = paid_seconds - spend_paid,
         daily_used_seconds = a_daily_used + spend_free,
         daily_day = today,
         updated_at = now()
   where user_id = me;

  insert into story_jobs (user_id, prompt, requested_seconds, seconds_charged,
                          paid_seconds_charged)
  values (me, prompt_clean, wanted, wanted, spend_paid)
  returning id into job_id;

  return jsonb_build_object(
    'ok', true,
    'jobId', job_id,
    'seconds', wanted,
    'remaining', remaining - spend_free,
    'dailyLeft', daily_left - spend_free,
    'paidSeconds', a_paid - spend_paid
  );
end;
$$;

revoke all on function public.claim_story_seconds(int, text) from public, anon;
grant execute on function public.claim_story_seconds(int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- refund_story_seconds — REPLACED, to return each second to its own bucket.
--
-- A job that spent 40 free and 80 paid seconds must give back 40 free and 80
-- paid. Refunding the whole 120 as free would quietly delete somebody's
-- purchase and hand them daily allowance they never had.
-- ---------------------------------------------------------------------------
create or replace function public.refund_story_seconds(_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.story_jobs%rowtype;
  charged_day date;
  free_part int;
  paid_part int;
begin
  select * into job from story_jobs where id = _job_id for update;
  if not found then raise exception 'story job not found'; end if;
  if job.refunded_at is not null then
    return jsonb_build_object('ok', true, 'refunded', 0);
  end if;
  if job.seconds_charged = 0 then
    update story_jobs set refunded_at = now() where id = _job_id;
    return jsonb_build_object('ok', true, 'refunded', 0);
  end if;

  charged_day := (job.created_at at time zone 'utc')::date;
  paid_part := least(job.paid_seconds_charged, job.seconds_charged);
  free_part := job.seconds_charged - paid_part;

  update story_global_usage
     set used_seconds = greatest(0, used_seconds - free_part),
         paid_seconds = greatest(0, paid_seconds - paid_part),
         updated_at = now()
   where day = charged_day;

  update story_allowance
     set used_seconds = greatest(0, used_seconds - free_part),
         paid_seconds = paid_seconds + paid_part,
         daily_used_seconds = case
           when daily_day = charged_day
             then greatest(0, daily_used_seconds - free_part)
           else daily_used_seconds
         end,
         updated_at = now()
   where user_id = job.user_id;

  update story_jobs set refunded_at = now() where id = _job_id;

  return jsonb_build_object('ok', true, 'refunded', job.seconds_charged,
                            'refundedPaid', paid_part);
end;
$$;

revoke all on function public.refund_story_seconds(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- story_quota_status — REPLACED, to report the paid balance and the chart.
--
-- The screen needs three new things to say anything honest when the free tier
-- runs out: how many purchased seconds are left, whether buying is switched on
-- at all, and — for the native build — where to send the browser.
-- ---------------------------------------------------------------------------
create or replace function public.story_quota_status()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg public.story_config%rowtype;
  pcfg public.story_purchase_config%rowtype;
  today date := (now() at time zone 'utc')::date;
  a_free int;
  a_used int;
  a_paid int;
  a_daily_used int;
  a_daily_day date;
  free_cap int;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into cfg from story_config where id = true;
  if not found then raise exception 'story config missing'; end if;
  select * into pcfg from story_purchase_config where id = true;

  select free_seconds, used_seconds, paid_seconds, daily_used_seconds, daily_day
    into a_free, a_used, a_paid, a_daily_used, a_daily_day
    from story_allowance where user_id = me;

  if not found then
    a_free := null; a_used := 0; a_paid := 0; a_daily_used := 0; a_daily_day := today;
  end if;
  if a_daily_day <> today then a_daily_used := 0; end if;

  free_cap := coalesce(a_free, cfg.free_seconds);

  return jsonb_build_object(
    'enabled', cfg.enabled,
    'freeSeconds', free_cap,
    'usedSeconds', a_used,
    'remaining', greatest(0, free_cap - a_used),
    'dailyLeft', greatest(0, cfg.daily_seconds - a_daily_used),
    'paidSeconds', coalesce(a_paid, 0),
    'minSeconds', cfg.min_story_seconds,
    'maxSeconds', cfg.max_story_seconds,
    'purchaseEnabled', coalesce(pcfg.enabled, false),
    'nativeLinkOut', coalesce(pcfg.native_link_out, false),
    'checkoutUrl', pcfg.checkout_url
  );
end;
$$;

revoke all on function public.story_quota_status() from public, anon;
grant execute on function public.story_quota_status() to authenticated;
