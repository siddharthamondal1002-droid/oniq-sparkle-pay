-- ============================================================================
-- THE ONIQ WATERMARK — on every generated Story by default, and a flat
-- ₹154 to take it off.
--
-- OWNER DIRECTIVE (2026-08-11): "Give oniq watermark to oniq videos, user
-- can take it down for flat rs 154/-". Flat means flat: the same price for
-- a 30-second short and a 12-minute film, unlike the duration-priced videos
-- themselves.
--
-- HOW REMOVAL WORKS. The watermark is burned into the render, so removing
-- it from an already-delivered film means rendering a clean copy. The
-- lifecycle floor (story_jobs_guard_transition) has no legal road from
-- delivered back to queued — by design — so removal CLONES the job as a
-- fresh queued row with seconds_charged = 0 (no quota debit; the user
-- already paid for those seconds once) and no_watermark = true. Jobs still
-- in flight just get the flag; the worker reads it at render time.
--
-- Payment discipline is the house standard: the client never names a
-- price, the row is created before the Razorpay order, the webhook settles
-- by provider order id, and settlement is idempotent.
-- ============================================================================
alter table public.story_jobs
  add column if not exists no_watermark boolean not null default false;

create table if not exists public.story_addons (
  key text primary key,
  label text not null,
  price_paise int not null check (price_paise > 0),
  active boolean not null default true
);
grant select on public.story_addons to authenticated;
alter table public.story_addons enable row level security;
drop policy if exists "addons readable" on public.story_addons;
create policy "addons readable" on public.story_addons
  for select to authenticated using (true);
insert into public.story_addons (key, label, price_paise, active)
values ('watermark_removal', 'Remove the ONIQ watermark', 15400, true)
on conflict (key) do update
  set label = excluded.label, price_paise = excluded.price_paise;

create table if not exists public.watermark_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.story_jobs(id) on delete cascade,
  -- Copied from the addon at purchase time, never joined later.
  price_paise int not null check (price_paise > 0),
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'created' check (status in ('created', 'paid', 'failed')),
  provider text not null default 'razorpay',
  provider_order_id text unique,
  provider_payment_id text,
  -- Idempotency: a webhook and a client verify both arriving means the
  -- second application is a no-op, not a second clone job.
  applied boolean not null default false,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.watermark_purchases to authenticated;
alter table public.watermark_purchases enable row level security;
drop policy if exists "own watermark purchases" on public.watermark_purchases;
create policy "own watermark purchases" on public.watermark_purchases
  for select to authenticated using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Service-role: flip the flag; clone for re-render when the film already
-- shipped. Returns the clone id when one was made.
-- ----------------------------------------------------------------------------
create or replace function public.grant_watermark_removal(_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  j story_jobs%rowtype;
  clone_id uuid;
begin
  select * into j from story_jobs where id = _job_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no-such-job');
  end if;
  if j.no_watermark then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  update story_jobs set no_watermark = true where id = _job_id;
  if j.status in ('ready', 'delivering', 'delivered') then
    insert into story_jobs
      (user_id, status, prompt, requested_seconds, seconds_charged, no_watermark)
    values
      (j.user_id, 'queued', j.prompt, j.requested_seconds, 0, true)
    returning id into clone_id;
  end if;
  return jsonb_build_object('ok', true, 'rerenderJobId', clone_id);
end;
$$;
revoke all on function public.grant_watermark_removal(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Caller-auth: start a purchase. Prices from story_addons, never the client.
-- ----------------------------------------------------------------------------
create or replace function public.create_watermark_purchase(_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  addon story_addons%rowtype;
  j story_jobs%rowtype;
  pid uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into addon from story_addons where key = 'watermark_removal';
  if not found or addon.active is not true then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;
  select * into j from story_jobs where id = _job_id and user_id = me;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no-such-job');
  end if;
  if j.no_watermark then
    return jsonb_build_object('ok', false, 'reason', 'already-clean');
  end if;
  insert into watermark_purchases (user_id, job_id, price_paise, currency)
  values (me, _job_id, addon.price_paise, 'INR')
  returning id into pid;
  return jsonb_build_object(
    'ok', true,
    'purchaseId', pid,
    'label', addon.label,
    'amountMinor', addon.price_paise,
    'currency', 'INR'
  );
end;
$$;
revoke all on function public.create_watermark_purchase(uuid) from public, anon;
grant execute on function public.create_watermark_purchase(uuid) to authenticated;

-- Service-role: record the Razorpay order id the webhook will settle by.
create or replace function public.attach_watermark_purchase_order(
  _purchase_id uuid,
  _provider_order_id text
)
returns void
language sql
security definer
set search_path = public
as $$
  update watermark_purchases
     set provider_order_id = _provider_order_id, updated_at = now()
   where id = _purchase_id and status = 'created';
$$;
revoke all on function public.attach_watermark_purchase_order(uuid, text)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Service-role, idempotent: the webhook (or client verify) settles by
-- provider order id. First settle applies the removal; any repeat is a no-op.
-- ----------------------------------------------------------------------------
create or replace function public.settle_watermark_purchase(
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
  p watermark_purchases%rowtype;
  applied_result jsonb := null;
begin
  select * into p from watermark_purchases
   where provider_order_id = _provider_order_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no-such-purchase');
  end if;
  if p.status = 'paid' and p.applied then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  update watermark_purchases
     set status = 'paid',
         provider_payment_id = coalesce(_provider_payment_id, provider_payment_id),
         updated_at = now()
   where id = p.id;
  if not p.applied then
    applied_result := grant_watermark_removal(p.job_id);
    update watermark_purchases set applied = true, updated_at = now() where id = p.id;
  end if;
  return jsonb_build_object('ok', true, 'confirmedBy', _confirmed_by, 'applied', applied_result);
end;
$$;
revoke all on function public.settle_watermark_purchase(text, text, text)
  from public, anon, authenticated;

-- Failure marker, mirroring fail_story_purchase.
create or replace function public.fail_watermark_purchase(
  _provider_order_id text,
  _error text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update watermark_purchases
     set status = 'failed', error = left(coalesce(_error, 'payment failed'), 300),
         updated_at = now()
   where provider_order_id = _provider_order_id and status = 'created';
$$;
revoke all on function public.fail_watermark_purchase(text, text)
  from public, anon, authenticated;
